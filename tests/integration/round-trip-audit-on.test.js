/**
 * Round-trip lifecycle test (audit-log ON).
 *
 * Installs the `minimal` profile with settings.require_audit_log forced to
 * true, then uninstalls. Asserts:
 *   - audit.jsonl is created during install and survives uninstall (the
 *     audit trail is intentionally NOT a managed file, by design).
 *   - audit.jsonl contains both install and uninstall entries.
 *   - All other managed files are removed by uninstall.
 *
 * Pair with: round-trip-audit-off.test.js (asserts zero residue when audit
 * logging is disabled — the audit-off case is the one the original combined
 * round-trip test masked by filtering audit.jsonl out of the residual diff).
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'install-rt-audit-on-'));
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

function buildPlanWithAuditOn(tmp, target) {
  const plan = createManifestInstallPlan({
    profileId: 'minimal',
    target,
    homeDir: tmp,
    projectRoot: tmp,
  });
  // Force require_audit_log:true regardless of what minimal declares so
  // this test exercises the audit-on code path deterministically.
  const previousSettings = (plan.statePreview && plan.statePreview.settings) || {};
  plan.statePreview = {
    ...plan.statePreview,
    settings: { ...previousSettings, require_audit_log: true, scope: 'project' },
  };
  const adapter = getInstallTargetAdapter(target);
  return {
    ...plan,
    adapter,
    homeDir: tmp,
    projectRoot: tmp,
    scope: 'project',
  };
}

function runTests() {
  console.log('\n=== Round-trip (audit ON): minimal profile ===\n');

  let passed = 0;
  let failed = 0;

  for (const target of ['claude', 'codex']) {
    if (test(`minimal x ${target} (audit ON): audit.jsonl is created and survives uninstall`, () => {
      const tmp = createTempDir();
      try {
        assert.deepStrictEqual(listAllFiles(tmp), [], 'baseline should be empty');

        const plan = buildPlanWithAuditOn(tmp, target);
        applyInstallPlan(plan);

        const filesAfterInstall = listAllFiles(tmp);
        assert.ok(filesAfterInstall.length > 0, 'install should write files');

        // Audit log must exist after install.
        const auditEntries = filesAfterInstall.filter(
          f => f.endsWith(path.join('ecc', 'audit.jsonl'))
        );
        assert.strictEqual(auditEntries.length, 1,
          `expected exactly one audit.jsonl after install, found: ${auditEntries.join(', ')}`);

        const auditPath = path.join(tmp, auditEntries[0]);
        const installLog = fs.readFileSync(auditPath, 'utf8').trim().split('\n').filter(Boolean);
        assert.strictEqual(installLog.length, 1,
          `expected 1 audit entry after install, got ${installLog.length}`);
        const installEvent = JSON.parse(installLog[0]);
        assert.strictEqual(installEvent.action, 'install-apply');

        // Uninstall.
        const report = uninstallInstalledStates({
          homeDir: tmp,
          projectRoot: tmp,
          targets: [target],
        });
        const result = report.results.find(r => r.adapter && r.adapter.target === target);
        assert.ok(result, `expected uninstall result for target=${target}`);
        assert.strictEqual(result.status, 'uninstalled', `uninstall failed: ${result.error}`);

        // Audit file must still exist — uninstall does NOT remove it.
        assert.ok(fs.existsSync(auditPath),
          'audit.jsonl should survive uninstall (it is the audit trail)');
        const finalLog = fs.readFileSync(auditPath, 'utf8').trim().split('\n').filter(Boolean);
        assert.ok(finalLog.length >= 2,
          `expected at least 2 audit entries (install + uninstall), got ${finalLog.length}`);
        const finalEvents = finalLog.map(line => JSON.parse(line));
        const actions = finalEvents.map(e => e.action);
        assert.ok(actions.includes('install-apply'), `expected install-apply in audit events: ${actions.join(',')}`);
        assert.ok(actions.some(a => /uninstall/.test(a)),
          `expected an uninstall audit event: ${actions.join(',')}`);

        // All other files must be gone — only audit.jsonl + its parent dir remain.
        const residualOtherThanAudit = listAllFiles(tmp).filter(
          f => !f.endsWith(path.join('ecc', 'audit.jsonl'))
        );
        assert.deepStrictEqual(
          residualOtherThanAudit, [],
          `expected only audit.jsonl to remain after uninstall, got extra: ${residualOtherThanAudit.join(', ')}`
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
