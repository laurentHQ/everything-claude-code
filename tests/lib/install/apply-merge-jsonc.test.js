/**
 * V1 Wave 1 / T2-rest: unit tests for the `merge-jsonc` apply-time handler
 * in scripts/lib/install/apply.js.
 *
 * Contract:
 *  - When destination is missing, the merge payload is written as plain JSON.
 *  - When destination contains JSONC (with comments), comments are stripped
 *    before parsing, and the merged result is written as plain JSON
 *    (no comments preserved).
 *  - When destination contains unparseable JSONC, a descriptive error throws.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { __internal } = require('../../../scripts/lib/install/apply');
const { handleMergeJsonc } = __internal;

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
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'apply-merge-jsonc-')));
}

function rmTmp(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_e) { /* best-effort */ }
}

function runTests() {
  console.log('\n=== V1 Wave 1 / T2-rest: handleMergeJsonc ===\n');
  let passed = 0;
  let failed = 0;

  if (test('writes payload as plain JSON when destination does not exist', () => {
    const tmp = mkTmp();
    try {
      const dest = path.join(tmp, 'out.json');
      handleMergeJsonc({
        destinationPath: dest,
        mergePayload: { a: 1, b: { c: 2 } },
      }, {});
      const out = JSON.parse(fs.readFileSync(dest, 'utf8'));
      assert.deepStrictEqual(out, { a: 1, b: { c: 2 } });
    } finally { rmTmp(tmp); }
  })) passed++; else failed++;

  if (test('strips // and /* */ comments from existing JSONC and deep-merges', () => {
    const tmp = mkTmp();
    try {
      const dest = path.join(tmp, 'out.json');
      fs.writeFileSync(dest, [
        '// header comment',
        '{',
        '  "a": 1, /* inline */',
        '  "nested": { "x": 1 } // line tail',
        '}',
      ].join('\n'));
      handleMergeJsonc({
        destinationPath: dest,
        mergePayload: { b: 2, nested: { y: 2 } },
      }, {});
      const out = JSON.parse(fs.readFileSync(dest, 'utf8'));
      assert.deepStrictEqual(out, { a: 1, b: 2, nested: { x: 1, y: 2 } });
      // Output contains no comments.
      const raw = fs.readFileSync(dest, 'utf8');
      assert.ok(!/\/\//.test(raw), 'output should contain no // comments');
      assert.ok(!/\/\*/.test(raw), 'output should contain no /* */ comments');
    } finally { rmTmp(tmp); }
  })) passed++; else failed++;

  if (test('throws "merge-jsonc failed to parse" on invalid JSONC', () => {
    const tmp = mkTmp();
    try {
      const dest = path.join(tmp, 'out.json');
      fs.writeFileSync(dest, '{ not-even-close: }');
      let caught = null;
      try {
        handleMergeJsonc({
          destinationPath: dest,
          mergePayload: { ok: true },
        }, {});
      } catch (e) { caught = e; }
      assert.ok(caught, 'expected throw');
      assert.ok(
        /merge-jsonc failed to parse/.test(caught.message),
        `got: ${caught.message}`
      );
    } finally { rmTmp(tmp); }
  })) passed++; else failed++;

  if (test('missing mergePayload throws', () => {
    const tmp = mkTmp();
    try {
      const dest = path.join(tmp, 'out.json');
      let caught = null;
      try {
        handleMergeJsonc({ destinationPath: dest }, {});
      } catch (e) { caught = e; }
      assert.ok(caught, 'expected throw');
      assert.ok(/Missing merge payload/.test(caught.message), `got: ${caught.message}`);
    } finally { rmTmp(tmp); }
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
