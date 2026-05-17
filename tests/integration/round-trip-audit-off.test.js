/**
 * Round-trip lifecycle test (audit-log OFF).
 *
 * Installs the `minimal` profile with settings.require_audit_log explicitly
 * unset, then uninstalls. Asserts:
 *   - audit.jsonl is NEVER created during install or uninstall.
 *   - After uninstall, the temp dir returns to a completely empty baseline
 *     (zero residual files).
 *
 * This is the case the original combined round-trip masked: it filtered
 * audit.jsonl out of the residual diff, so an audit-off run that
 * accidentally wrote audit.jsonl would have looked clean. Splitting the
 * two cases means audit-off can assert *complete* baseline restoration.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  applyInstallPlan,
  createManifestInstallPlan,
} = require('../../scripts/lib/install-executor');
const { getInstallTargetAdapter } = require('../../scripts/lib/install-targets/registry');
const { uninstallInstalledStates } = require('../../scripts/lib/install-lifecycle');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'install-rt-audit-off-'));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function listAllFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const result = [];
  function walk(current) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) result.push(path.relative(dir, full));
    }
  }
  walk(dir);
  result.sort();
  return result;
}

function buildPlanWithAuditOff(tmp, target) {
  const plan = createManifestInstallPlan({
    profileId: 'minimal',
    target,
    homeDir: tmp,
    projectRoot: tmp,
  });
  // Explicitly strip require_audit_log so this test does not depend on
  // whatever the minimal profile happens to set.
  const previousSettings = (plan.statePreview && plan.statePreview.settings) || {};
  const { require_audit_log: _drop, ...settingsWithoutAudit } = previousSettings;
  plan.statePreview = {
    ...plan.statePreview,
    settings: { ...settingsWithoutAudit },
  };
  const adapter = getInstallTargetAdapter(target);
  return {
    ...plan,
    adapter,
    homeDir: tmp,
    projectRoot: tmp,
  };
}

function runTests() {
  console.log('\n=== Round-trip (audit OFF): minimal profile ===\n');

  let passed = 0;
  let failed = 0;

  for (const target of ['claude', 'codex']) {
    if (test(`minimal x ${target} (audit OFF): zero residual files after uninstall`, () => {
      const tmp = createTempDir();
      try {
        assert.deepStrictEqual(listAllFiles(tmp), [], 'baseline should be empty');

        const plan = buildPlanWithAuditOff(tmp, target);
        applyInstallPlan(plan);

        const filesAfterInstall = listAllFiles(tmp);
        assert.ok(filesAfterInstall.length > 0, 'install should write files');

        // audit.jsonl must NOT be present.
        const auditEntries = filesAfterInstall.filter(
          f => f.endsWith(path.join('ecc', 'audit.jsonl'))
        );
        assert.deepStrictEqual(auditEntries, [],
          `audit.jsonl must not be created when require_audit_log is unset, found: ${auditEntries.join(', ')}`);

        const report = uninstallInstalledStates({
          homeDir: tmp,
          projectRoot: tmp,
          targets: [target],
        });
        const result = report.results.find(r => r.adapter && r.adapter.target === target);
        assert.ok(result, `expected uninstall result for target=${target}`);
        assert.strictEqual(result.status, 'uninstalled', `uninstall failed: ${result.error}`);

        // Audit must STILL be absent after uninstall.
        const filesAfterUninstall = listAllFiles(tmp);
        const auditAfter = filesAfterUninstall.filter(
          f => f.endsWith(path.join('ecc', 'audit.jsonl'))
        );
        assert.deepStrictEqual(auditAfter, [],
          'audit.jsonl must not appear during uninstall when audit is off');

        // Complete baseline restoration: zero residual files.
        assert.deepStrictEqual(
          filesAfterUninstall, [],
          `expected zero residual files (audit OFF), got: ${filesAfterUninstall.join(', ')}`
        );
      } finally {
        cleanup(tmp);
      }
    })) passed++; else failed++;
  }

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
