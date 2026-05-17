/**
 * Integration test for Wave 0 (I7): applyInstallPlan rejects operation
 * kinds that are not present in its dispatch table.
 *
 * Why this matters: the schema enum (install-operations.schema.json) is
 * checked at plan-build time, but applyInstallPlan is called from many
 * code paths (in-process build, JSON-imported plan, programmatic test).
 * A defense-in-depth runtime check at the dispatcher prevents a malformed
 * plan from silently writing nothing or — worse — partially applying when
 * later operations fail.
 *
 * Contract:
 *   - throws with a message containing both the unknown kind and
 *     "Unsupported install operation kind"
 *   - no destination file is written
 *   - no install-state file is written
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const { applyInstallPlan } = require(path.join(REPO_ROOT, 'scripts', 'lib', 'install', 'apply'));

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

function mkTmp() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'apply-unknown-kind-')));
}

function rmTmp(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_e) { /* best-effort */ }
}

function runTests() {
  console.log('\n=== Wave 0 / I7: applyInstallPlan rejects unknown operation kinds ===\n');

  let passed = 0;
  let failed = 0;

  if (test('rejects "symlink" (not in dispatch table) and writes nothing', () => {
    const tmp = mkTmp();
    try {
      const srcFile = path.join(tmp, 'source.txt');
      fs.writeFileSync(srcFile, 'A');

      const destFile = path.join(tmp, 'dest.txt');
      const installStatePath = path.join(tmp, 'state.json');

      const plan = {
        // No allowedRoots: keep the failure isolated to dispatch.
        adapter: { allowedRoots: () => [] },
        operations: [
          {
            kind: 'symlink',
            moduleId: 'mod',
            sourcePath: srcFile,
            destinationPath: destFile,
          },
        ],
        installStatePath,
        statePreview: { schemaVersion: 'ecc.install.v2' },
        targetRoot: tmp,
      };

      let caught = null;
      try {
        applyInstallPlan(plan);
      } catch (error) {
        caught = error;
      }
      assert.ok(caught, 'applyInstallPlan should throw on unknown operation kind');
      assert.ok(
        caught.message.includes('symlink'),
        `error should mention the unknown kind "symlink", got: ${caught.message}`
      );
      assert.ok(
        caught.message.includes('Unsupported install operation kind'),
        `error should mention dispatch contract, got: ${caught.message}`
      );

      assert.ok(!fs.existsSync(destFile), 'no destination file should be written');
      assert.ok(!fs.existsSync(installStatePath), 'no install-state file should be written');
    } finally {
      rmTmp(tmp);
    }
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
