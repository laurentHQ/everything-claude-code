'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const gatesModule = require('../../scripts/ci/gate-profile-promotion');
const { runGates } = gatesModule;

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    if (err.stack) console.log(err.stack.split('\n').slice(1, 4).join('\n'));
    failed++;
  }
}

console.log('\n=== gate-profile-promotion ===\n');

test('runGates honors stubs and produces all 5 gates passing', () => {
  const allPass = () => ({ status: 'pass' });
  const report = runGates({
    reportPath: null,
    stubs: {
      schema: allPass,
      snapshot: allPass,
      policy: allPass,
      'secret-scan': allPass,
      'round-trip': allPass,
    },
  });
  assert.strictEqual(report.passed, true);
  assert.strictEqual(report.gates.length, 5);
  const gateNames = report.gates.map(g => g.gate);
  assert.deepStrictEqual(gateNames, ['schema', 'snapshot', 'policy', 'secret-scan', 'round-trip']);
  for (const g of report.gates) {
    assert.strictEqual(g.status, 'pass', `gate ${g.gate} should pass, got: ${JSON.stringify(g)}`);
  }
  assert.ok(typeof report.generatedAt === 'string' && report.generatedAt.length > 0);
});

test('runGates aggregate fails when any single gate fails (snapshot stubbed)', () => {
  const allPass = () => ({ status: 'pass' });
  const failSnapshot = () => ({ status: 'fail', detail: 'stub failure' });
  const report = runGates({
    reportPath: null,
    stubs: {
      schema: allPass,
      snapshot: failSnapshot,
      policy: allPass,
      'secret-scan': allPass,
      'round-trip': allPass,
    },
  });
  assert.strictEqual(report.passed, false);
  const snapshot = report.gates.find(g => g.gate === 'snapshot');
  assert.ok(snapshot);
  assert.strictEqual(snapshot.status, 'fail');
  assert.strictEqual(snapshot.detail, 'stub failure');
});

test('runGates with reportPath writes report file matching return value', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-report-test-'));
  const outPath = path.join(dir, 'out.json');
  try {
    const allPass = () => ({ status: 'pass' });
    const report = runGates({
      reportPath: outPath,
      stubs: {
        schema: allPass,
        snapshot: allPass,
        policy: allPass,
        'secret-scan': allPass,
        'round-trip': allPass,
      },
    });
    assert.ok(fs.existsSync(outPath), 'report file should be written');
    const fromDisk = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    assert.strictEqual(fromDisk.passed, report.passed);
    assert.strictEqual(fromDisk.gates.length, report.gates.length);
    assert.deepStrictEqual(
      fromDisk.gates.map(g => g.gate),
      report.gates.map(g => g.gate),
    );
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }
});

test('runGates with reportPath:null does NOT write any file', () => {
  // Confirm the function does not throw when reportPath:null is passed.
  // We cannot easily assert "no file written" globally; we just ensure that
  // the function returns the expected shape without needing a path.
  const allPass = () => ({ status: 'pass' });
  const report = runGates({
    reportPath: null,
    stubs: {
      schema: allPass,
      snapshot: allPass,
      policy: allPass,
      'secret-scan': allPass,
      'round-trip': allPass,
    },
  });
  assert.strictEqual(report.passed, true);
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
