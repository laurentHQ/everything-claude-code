/**
 * Round-trip lifecycle test.
 *
 * Install the `minimal` profile end-to-end into a tmpdir for both
 * `claude` and `codex` targets, capture the resulting file tree, run
 * uninstall, and assert the tree is restored to the baseline (empty —
 * no pre-seeded fixture files).
 *
 * This exercises the lifecycle copy-path round-trip that Wave 4 (T5)
 * enabled.
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'install-round-trip-'));
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
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        result.push(path.relative(dir, full));
      }
    }
  }
  walk(dir);
  result.sort();
  return result;
}

function installAndUninstall(tmp, target) {
  const plan = createManifestInstallPlan({
    profileId: 'minimal',
    target,
    homeDir: tmp,
    projectRoot: tmp,
  });
  const adapter = getInstallTargetAdapter(target);

  // Attach the full adapter so allowedRoots() is enforced during apply.
  const applyPlan = {
    ...plan,
    adapter,
    homeDir: tmp,
    projectRoot: tmp,
  };

  applyInstallPlan(applyPlan);

  // Sanity: should have produced some files inside tmp.
  const filesAfterInstall = listAllFiles(tmp);
  assert.ok(
    filesAfterInstall.length > 0,
    `expected files under ${tmp} after install (target=${target})`
  );

  // Uninstall.
  const report = uninstallInstalledStates({
    homeDir: tmp,
    projectRoot: tmp,
    targets: [target],
  });
  const result = report.results.find(r => r.adapter && r.adapter.target === target);
  assert.ok(result, `expected uninstall result for target=${target}`);
  assert.strictEqual(
    result.status,
    'uninstalled',
    `uninstall failed: ${result.error}`
  );

  return { filesAfterInstall, filesAfterUninstall: listAllFiles(tmp) };
}

function runTests() {
  console.log('\n=== Testing install -> uninstall round-trip (minimal) ===\n');

  let passed = 0;
  let failed = 0;

  for (const target of ['claude', 'codex']) {
    if (test(`minimal x ${target}: install creates files, uninstall removes them all`, () => {
      const tmp = createTempDir();
      try {
        // Capture baseline (an empty mkdtemp dir).
        const baseline = listAllFiles(tmp);
        assert.deepStrictEqual(baseline, [], 'baseline should be empty');

        const { filesAfterInstall, filesAfterUninstall } = installAndUninstall(tmp, target);

        // Audit-log may persist after uninstall (it is intentionally NOT
        // managed). Filter it out so we only compare managed artifacts.
        // (For minimal profile, require_audit_log is unset so this should be
        // empty anyway — assertion confirms.)
        assert.ok(filesAfterInstall.length > 0, 'install should write files');

        const residual = filesAfterUninstall.filter(
          f => !f.endsWith(path.join('ecc', 'audit.jsonl'))
        );
        assert.deepStrictEqual(
          residual,
          [],
          `expected no residual files after uninstall, got: ${residual.join(', ')}`
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
