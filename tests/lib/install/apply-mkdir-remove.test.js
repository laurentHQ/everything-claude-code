/**
 * V1 Wave 1 / T2-rest: unit tests for the `mkdir` and `remove` apply-time
 * handlers in scripts/lib/install/apply.js.
 *
 * Contract:
 *  - handleMkdir creates a nested path recursively and is idempotent.
 *  - handleRemove is a no-op when the destination does not exist.
 *  - handleRemove deletes an existing file.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { __internal } = require('../../../scripts/lib/install/apply');
const { handleMkdir, handleRemove } = __internal;

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
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'apply-mkdir-remove-')));
}

function rmTmp(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_e) { /* best-effort */ }
}

function runTests() {
  console.log('\n=== V1 Wave 1 / T2-rest: handleMkdir / handleRemove ===\n');
  let passed = 0;
  let failed = 0;

  if (test('handleMkdir creates a nested path', () => {
    const tmp = mkTmp();
    try {
      const nested = path.join(tmp, 'a', 'b', 'c');
      handleMkdir({ destinationPath: nested }, {});
      const stat = fs.statSync(nested);
      assert.ok(stat.isDirectory(), 'expected a directory at the nested path');
    } finally { rmTmp(tmp); }
  })) passed++; else failed++;

  if (test('handleMkdir is idempotent (second call does not throw)', () => {
    const tmp = mkTmp();
    try {
      const dir = path.join(tmp, 'idem');
      handleMkdir({ destinationPath: dir }, {});
      handleMkdir({ destinationPath: dir }, {});
      assert.ok(fs.statSync(dir).isDirectory());
    } finally { rmTmp(tmp); }
  })) passed++; else failed++;

  if (test('handleRemove on a missing path is a no-op', () => {
    const tmp = mkTmp();
    try {
      const ghost = path.join(tmp, 'never-existed.txt');
      // No throw.
      handleRemove({ destinationPath: ghost }, {});
      assert.ok(!fs.existsSync(ghost));
    } finally { rmTmp(tmp); }
  })) passed++; else failed++;

  if (test('handleRemove deletes an existing file', () => {
    const tmp = mkTmp();
    try {
      const target = path.join(tmp, 'doomed.txt');
      fs.writeFileSync(target, 'bye');
      handleRemove({ destinationPath: target }, {});
      assert.ok(!fs.existsSync(target));
    } finally { rmTmp(tmp); }
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
