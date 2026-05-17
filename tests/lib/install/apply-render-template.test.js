/**
 * V1 Wave 1 / T2-rest: unit tests for the `render-template` apply-time
 * handler in scripts/lib/install/apply.js.
 *
 * Contract:
 *  - Single substitution writes the expected output.
 *  - Missing context key throws (with a message that names the key).
 *  - `allowedKeys` rejects keys not in the list.
 *  - Multiple substitutions and whitespace in placeholders both work.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { __internal } = require('../../../scripts/lib/install/apply');
const { handleRenderTemplate } = __internal;

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
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'apply-render-template-')));
}

function rmTmp(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_e) { /* best-effort */ }
}

function runTests() {
  console.log('\n=== V1 Wave 1 / T2-rest: handleRenderTemplate ===\n');
  let passed = 0;
  let failed = 0;

  if (test('happy path: single {{key}} substitution', () => {
    const tmp = mkTmp();
    try {
      const src = path.join(tmp, 'tpl.txt');
      const dest = path.join(tmp, 'out.txt');
      fs.writeFileSync(src, 'Hello {{name}}!');
      handleRenderTemplate({ sourcePath: src, destinationPath: dest, context: { name: 'World' } }, {});
      assert.strictEqual(fs.readFileSync(dest, 'utf8'), 'Hello World!');
    } finally { rmTmp(tmp); }
  })) passed++; else failed++;

  if (test('missing context key throws with key name', () => {
    const tmp = mkTmp();
    try {
      const src = path.join(tmp, 'tpl.txt');
      const dest = path.join(tmp, 'out.txt');
      fs.writeFileSync(src, 'Hi {{missing}}');
      let caught = null;
      try {
        handleRenderTemplate({ sourcePath: src, destinationPath: dest, context: {} }, {});
      } catch (e) { caught = e; }
      assert.ok(caught, 'expected throw');
      assert.ok(/missing context key "missing"/.test(caught.message), `got: ${caught.message}`);
      assert.ok(!fs.existsSync(dest), 'output file should not be written on failure');
    } finally { rmTmp(tmp); }
  })) passed++; else failed++;

  if (test('allowedKeys restriction rejects disallowed key', () => {
    const tmp = mkTmp();
    try {
      const src = path.join(tmp, 'tpl.txt');
      const dest = path.join(tmp, 'out.txt');
      fs.writeFileSync(src, 'Hi {{secret}}');
      let caught = null;
      try {
        handleRenderTemplate({
          sourcePath: src,
          destinationPath: dest,
          context: { secret: 'shh', allowed: 'ok' },
          allowedKeys: ['allowed'],
        }, {});
      } catch (e) { caught = e; }
      assert.ok(caught, 'expected throw');
      assert.ok(/not in allowedKeys/.test(caught.message), `got: ${caught.message}`);
    } finally { rmTmp(tmp); }
  })) passed++; else failed++;

  if (test('allowedKeys allows listed key', () => {
    const tmp = mkTmp();
    try {
      const src = path.join(tmp, 'tpl.txt');
      const dest = path.join(tmp, 'out.txt');
      fs.writeFileSync(src, 'Hi {{name}}');
      handleRenderTemplate({
        sourcePath: src,
        destinationPath: dest,
        context: { name: 'Alice' },
        allowedKeys: ['name'],
      }, {});
      assert.strictEqual(fs.readFileSync(dest, 'utf8'), 'Hi Alice');
    } finally { rmTmp(tmp); }
  })) passed++; else failed++;

  if (test('multiple substitutions in one template', () => {
    const tmp = mkTmp();
    try {
      const src = path.join(tmp, 'tpl.txt');
      const dest = path.join(tmp, 'out.txt');
      fs.writeFileSync(src, '{{a}}+{{b}}={{c}}');
      handleRenderTemplate({
        sourcePath: src,
        destinationPath: dest,
        context: { a: 1, b: 2, c: 3 },
      }, {});
      assert.strictEqual(fs.readFileSync(dest, 'utf8'), '1+2=3');
    } finally { rmTmp(tmp); }
  })) passed++; else failed++;

  if (test('whitespace inside {{ key }} matches', () => {
    const tmp = mkTmp();
    try {
      const src = path.join(tmp, 'tpl.txt');
      const dest = path.join(tmp, 'out.txt');
      fs.writeFileSync(src, '{{ name }} and {{name}}');
      handleRenderTemplate({
        sourcePath: src,
        destinationPath: dest,
        context: { name: 'X' },
      }, {});
      assert.strictEqual(fs.readFileSync(dest, 'utf8'), 'X and X');
    } finally { rmTmp(tmp); }
  })) passed++; else failed++;

  if (test('missing sourcePath throws', () => {
    let caught = null;
    try {
      handleRenderTemplate({ destinationPath: '/tmp/x' }, {});
    } catch (e) { caught = e; }
    assert.ok(caught, 'expected throw');
    assert.ok(/render-template missing sourcePath/.test(caught.message), `got: ${caught.message}`);
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
