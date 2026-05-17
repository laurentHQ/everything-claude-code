/**
 * T6 enforcement positive assertions.
 *
 * Validates that the policy gate added in V1 Wave 2 (T6) actually emits
 * the conflict reasons that MVP-era code only surfaced via safety flags.
 *
 *   - allow_mcp:false  →  mcp-not-allowed conflict when an mcp:* component
 *                          is requested via --with.
 *   - block_global_install:true  →  global-install-blocked when scope:user
 *                                    is requested against a profile that
 *                                    forbids global installs.
 *   - applyInstallPlan refuses to run when handed a plan whose conflicts
 *     already carry severity:"error" (defense-in-depth).
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolveInstallPlan } = require('../../scripts/lib/install-manifests');
const { buildPlanDocument } = require('../../scripts/lib/install/plan-operations');
const { getInstallTargetAdapter } = require('../../scripts/lib/install-targets/registry');
const { applyInstallPlan } = require('../../scripts/lib/install-executor');

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

function buildSecurityPlan(tmp, extra = {}) {
  const resolved = resolveInstallPlan({
    profileId: 'security',
    target: 'claude',
    homeDir: tmp,
    projectRoot: tmp,
  });
  // The install-components manifest has no mcp:* entries today, so we
  // cannot funnel mcp:context7 through resolveInstallPlan (it would throw
  // "Unknown install component"). Inject the includedComponentIds field
  // directly on the resolved object — evaluatePolicy reads it verbatim.
  const merged = {
    ...resolved,
    scope: extra.scope || null,
    includedComponentIds: extra.includeComponentIds || resolved.includedComponentIds || [],
  };
  const adapter = getInstallTargetAdapter('claude');
  return buildPlanDocument(merged, adapter, {
    planningInput: {
      homeDir: tmp,
      projectRoot: tmp,
      targetRoot: resolved.targetRoot,
    },
    profileSettings: resolved.profileSettings,
    scope: extra.scope || null,
  });
}

function runTests() {
  console.log('\n=== T6 policy-gate enforcement (positive assertions) ===\n');

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

  if (test('T6: mcp-not-allowed conflict IS emitted when allow_mcp:false + --with mcp:context7', () => {
    const tmp = createTempDir();
    try {
      const plan = buildSecurityPlan(tmp, { includeComponentIds: ['mcp:context7'] });
      const mcpConflicts = plan.conflicts.filter(c => c.reason === 'mcp-not-allowed');
      assert.strictEqual(
        mcpConflicts.length,
        1,
        `expected exactly 1 mcp-not-allowed conflict, got ${mcpConflicts.length}`
      );
      assert.strictEqual(mcpConflicts[0].severity, 'error', 'must be severity:error');
    } finally {
      cleanup(tmp);
    }
  })) passed++; else failed++;

  if (test('T6: global-install-blocked IS emitted when block_global_install:true + scope:user', () => {
    const tmp = createTempDir();
    try {
      const plan = buildSecurityPlan(tmp, { scope: 'user' });
      const globalConflicts = plan.conflicts.filter(c => c.reason === 'global-install-blocked');
      assert.strictEqual(
        globalConflicts.length,
        1,
        `expected exactly 1 global-install-blocked conflict, got ${globalConflicts.length}`
      );
      assert.strictEqual(globalConflicts[0].severity, 'error', 'must be severity:error');
    } finally {
      cleanup(tmp);
    }
  })) passed++; else failed++;

  if (test('T6: applyInstallPlan throws when handed a plan with severity:error conflicts', () => {
    const tmp = createTempDir();
    try {
      const destination = path.join(tmp, 'should-not-exist.txt');
      const syntheticPlan = {
        mode: 'manifest',
        target: 'claude',
        operations: [],
        conflicts: [{
          destination,
          reason: 'mcp-not-allowed',
          severity: 'error',
          resolution: 'synthetic-test-conflict',
        }],
      };
      let caught;
      try {
        applyInstallPlan(syntheticPlan);
      } catch (err) {
        caught = err;
      }
      assert.ok(caught, 'expected applyInstallPlan to throw');
      assert.ok(
        /install refused|\[policy\]/.test(caught.message),
        `expected "install refused" or "[policy]" substring, got: ${caught.message}`
      );
      assert.strictEqual(
        fs.existsSync(destination),
        false,
        'no destination file should have been written'
      );
    } finally {
      cleanup(tmp);
    }
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
