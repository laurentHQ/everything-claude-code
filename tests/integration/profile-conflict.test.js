/**
 * MVP conflict-gap tests.
 *
 * Coordination note 4 (see docs/MVP-LIMITATIONS.md when added):
 *   - allow_mcp:false is STORED in profile settings and surfaced via
 *     safety.mcpAllowed, but the planner does NOT yet emit a
 *     `mcp-not-allowed` conflict at plan time. T6 will add that.
 *   - block_global_install:true is STORED and surfaced via
 *     safety.globalInstallAllowed:false, but the planner does NOT yet
 *     emit a `global-install-blocked` conflict at plan time. T6 will add that.
 *
 * These assertions look inverted on purpose: they pin the MVP-vs-T6 boundary
 * so a future change that adds those conflict reasons forces this test to be
 * intentionally updated.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolveInstallPlan } = require('../../scripts/lib/install-manifests');
const { buildPlanDocument } = require('../../scripts/lib/install/plan-operations');
const { getInstallTargetAdapter } = require('../../scripts/lib/install-targets/registry');

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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'profile-conflict-'));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function buildSecurityPlan(tmp) {
  const resolved = resolveInstallPlan({
    profileId: 'security',
    target: 'claude',
    homeDir: tmp,
    projectRoot: tmp,
  });
  const adapter = getInstallTargetAdapter('claude');
  return buildPlanDocument(resolved, adapter, {
    planningInput: {
      homeDir: tmp,
      projectRoot: tmp,
      targetRoot: resolved.targetRoot,
    },
    profileSettings: resolved.profileSettings,
  });
}

function runTests() {
  console.log('\n=== Testing MVP profile-conflict gaps (coord note 4) ===\n');

  let passed = 0;
  let failed = 0;

  if (test('security profile plan exposes allow_mcp:false in safety', () => {
    const tmp = createTempDir();
    try {
      const plan = buildSecurityPlan(tmp);
      assert.strictEqual(
        plan.safety.mcpAllowed,
        false,
        'security profile declares allow_mcp:false'
      );
    } finally {
      cleanup(tmp);
    }
  })) passed++; else failed++;

  if (test('security profile plan exposes block_global_install:true in safety', () => {
    const tmp = createTempDir();
    try {
      const plan = buildSecurityPlan(tmp);
      assert.strictEqual(
        plan.safety.globalInstallAllowed,
        false,
        'security profile declares block_global_install:true'
      );
    } finally {
      cleanup(tmp);
    }
  })) passed++; else failed++;

  // MVP-vs-T6 boundary assertions ----------------------------------------

  if (test('MVP: no mcp-not-allowed conflict is emitted even when allow_mcp:false', () => {
    const tmp = createTempDir();
    try {
      const plan = buildSecurityPlan(tmp);
      const mcpConflicts = plan.conflicts.filter(c => c.reason === 'mcp-not-allowed');
      assert.strictEqual(
        mcpConflicts.length,
        0,
        'T6 will add this conflict — update this test when it does. ' +
        'See docs/MVP-LIMITATIONS.md.'
      );
    } finally {
      cleanup(tmp);
    }
  })) passed++; else failed++;

  if (test('MVP: no global-install-blocked conflict is emitted even when block_global_install:true', () => {
    const tmp = createTempDir();
    try {
      const plan = buildSecurityPlan(tmp);
      const globalConflicts = plan.conflicts.filter(c => c.reason === 'global-install-blocked');
      assert.strictEqual(
        globalConflicts.length,
        0,
        'T6 will add this conflict — update this test when it does. ' +
        'See docs/MVP-LIMITATIONS.md.'
      );
    } finally {
      cleanup(tmp);
    }
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
