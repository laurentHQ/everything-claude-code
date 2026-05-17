/**
 * Tests for scripts/lib/install/policy.js (T6).
 *
 * Covers all four policy rules with positive (rule fires) and negative
 * (rule does NOT fire) cases, plus the input-shape assertion and the
 * assertNoBlockingConflicts gate behavior.
 */

'use strict';

const assert = require('assert');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const {
  evaluatePolicy,
  assertNoBlockingConflicts,
} = require(path.join(REPO_ROOT, 'scripts', 'lib', 'install', 'policy'));

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

// Runs `fn` with process.stderr.write monkey-patched to a capturing buffer.
// Returns { lines, error } — error is non-null if fn threw. Callers MUST
// inspect both halves; this never re-throws on its own so the buffer is
// guaranteed to survive any throw from fn.
function captureStderr(fn) {
  const original = process.stderr.write.bind(process.stderr);
  const lines = [];
  process.stderr.write = (chunk) => {
    lines.push(String(chunk));
    return true;
  };
  let error = null;
  try {
    fn();
  } catch (err) {
    error = err;
  } finally {
    process.stderr.write = original;
  }
  return { lines, error };
}

function runTests() {
  console.log('\n=== install/policy tests (T6) ===\n');

  let passed = 0;
  let failed = 0;

  // ---------- Rule 1: mcp-not-allowed via component ----------

  if (test('R1 positive: allow_mcp:false + mcp:context7 in includes → 1 conflict', () => {
    const result = evaluatePolicy(
      { selectedModules: [], includedComponentIds: ['mcp:context7'] },
      { allow_mcp: false }
    );
    const mcp = result.conflicts.filter(c => c.reason === 'mcp-not-allowed');
    assert.strictEqual(mcp.length, 1);
    assert.strictEqual(mcp[0].severity, 'error');
    assert.strictEqual(mcp[0].destination, 'mcp:context7');
  })) passed++; else failed++;

  if (test('R1 negative: allow_mcp:false + no mcp includes → no conflict', () => {
    const result = evaluatePolicy(
      { selectedModules: [], includedComponentIds: ['baseline:rules'] },
      { allow_mcp: false }
    );
    assert.strictEqual(result.conflicts.length, 0);
  })) passed++; else failed++;

  // ---------- Rule 1: mcp-not-allowed via module path ----------

  if (test('R1 positive (path): module with .mcp.json path + allow_mcp:false → 1 conflict', () => {
    const fakeMod = { id: 'fake-mcp', kind: 'platform', paths: ['.mcp.json'] };
    const result = evaluatePolicy(
      { selectedModules: [fakeMod], includedComponentIds: [] },
      { allow_mcp: false }
    );
    const mcp = result.conflicts.filter(c => c.reason === 'mcp-not-allowed');
    assert.strictEqual(mcp.length, 1);
    assert.strictEqual(mcp[0].moduleId, 'fake-mcp');
  })) passed++; else failed++;

  // ---------- Rule 2: allowlist enforcement ----------

  if (test('R2 positive: allow_mcp:true + allowed:[context7] + mcp:github → 1 conflict', () => {
    const result = evaluatePolicy(
      { selectedModules: [], includedComponentIds: ['mcp:github'] },
      { allow_mcp: true, allowed_mcp_servers: ['context7'] }
    );
    const mcp = result.conflicts.filter(c => c.reason === 'mcp-not-allowed');
    assert.strictEqual(mcp.length, 1);
    assert.ok(mcp[0].resolution.includes('github'), 'resolution mentions denied server');
  })) passed++; else failed++;

  if (test('R2 negative: allow_mcp:true + allowed:[context7] + mcp:context7 → no conflict', () => {
    const result = evaluatePolicy(
      { selectedModules: [], includedComponentIds: ['mcp:context7'] },
      { allow_mcp: true, allowed_mcp_servers: ['context7'] }
    );
    assert.strictEqual(result.conflicts.length, 0);
  })) passed++; else failed++;

  // ---------- Rule 3: global-install-blocked ----------

  if (test('R3 positive: block_global_install:true + scope:user → 1 conflict', () => {
    const result = evaluatePolicy(
      { selectedModules: [], includedComponentIds: [], scope: 'user' },
      { block_global_install: true }
    );
    const gib = result.conflicts.filter(c => c.reason === 'global-install-blocked');
    assert.strictEqual(gib.length, 1);
    assert.strictEqual(gib[0].severity, 'error');
  })) passed++; else failed++;

  if (test('R3 negative: block_global_install:true + scope:project → no conflict', () => {
    const result = evaluatePolicy(
      { selectedModules: [], includedComponentIds: [], scope: 'project' },
      { block_global_install: true }
    );
    assert.strictEqual(result.conflicts.length, 0);
  })) passed++; else failed++;

  // ---------- Rule 4: hook-risk-high ----------

  if (test('R4 positive: hook_profile:validation + kind:hooks/riskLevel:high → 1 conflict', () => {
    const risky = { id: 'risky-hook', kind: 'hooks', riskLevel: 'high', paths: ['hooks'] };
    const result = evaluatePolicy(
      { selectedModules: [risky], includedComponentIds: [] },
      { hook_profile: 'validation' }
    );
    const hrh = result.conflicts.filter(c => c.reason === 'hook-risk-high');
    assert.strictEqual(hrh.length, 1);
    assert.strictEqual(hrh[0].moduleId, 'risky-hook');
    assert.strictEqual(hrh[0].severity, 'error');
  })) passed++; else failed++;

  if (test('R4 negative: hook_profile:validation + kind:hooks/riskLevel:safe → no conflict', () => {
    const safe = { id: 'safe-hook', kind: 'hooks', riskLevel: 'safe', paths: ['hooks'] };
    const result = evaluatePolicy(
      { selectedModules: [safe], includedComponentIds: [] },
      { hook_profile: 'validation' }
    );
    assert.strictEqual(result.conflicts.length, 0);
  })) passed++; else failed++;

  // ---------- Input-shape assertion ----------

  if (test('input-shape: string IDs in selectedModules → throws', () => {
    let caught;
    try {
      evaluatePolicy(
        { selectedModules: ['rules-core', 'agents-core'], includedComponentIds: [] },
        { allow_mcp: false }
      );
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, 'expected throw');
    assert.ok(
      /expected full module objects/.test(caught.message),
      `expected "expected full module objects" substring, got: ${caught.message}`
    );
  })) passed++; else failed++;

  if (test('input-shape: empty selectedModules array passes', () => {
    const result = evaluatePolicy(
      { selectedModules: [], includedComponentIds: [] },
      { allow_mcp: false }
    );
    assert.deepStrictEqual(result, { conflicts: [], warnings: [] });
  })) passed++; else failed++;

  if (test('null resolvedRequest returns empty bag', () => {
    const result = evaluatePolicy(null, { allow_mcp: false });
    assert.deepStrictEqual(result, { conflicts: [], warnings: [] });
  })) passed++; else failed++;

  // ---------- assertNoBlockingConflicts ----------

  if (test('assertNoBlockingConflicts: empty conflicts → no throw, no stderr', () => {
    const { lines, error } = captureStderr(() => assertNoBlockingConflicts({ conflicts: [] }));
    assert.strictEqual(error, null);
    assert.strictEqual(lines.length, 0);
  })) passed++; else failed++;

  if (test('assertNoBlockingConflicts: ignores severity:warning', () => {
    const { lines, error } = captureStderr(() => {
      assertNoBlockingConflicts({
        conflicts: [{ destination: 'x', reason: 'mcp-not-allowed', severity: 'warning' }],
      });
    });
    assert.strictEqual(error, null);
    assert.strictEqual(lines.length, 0);
  })) passed++; else failed++;

  if (test('assertNoBlockingConflicts: throws on any severity:error + emits stderr', () => {
    const { lines, error } = captureStderr(() => {
      assertNoBlockingConflicts({
        conflicts: [
          { destination: 'a', reason: 'mcp-not-allowed', severity: 'error', resolution: 'fix-a' },
          { destination: 'b', reason: 'global-install-blocked', severity: 'error', resolution: 'fix-b' },
        ],
      });
    });
    assert.ok(error, 'expected throw');
    assert.ok(/install refused/.test(error.message));
    // One [policy] line per blocking conflict.
    const policyLines = lines.filter(l => l.includes('[policy]'));
    assert.strictEqual(policyLines.length, 2, `expected 2 [policy] lines, got ${policyLines.length}`);
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
