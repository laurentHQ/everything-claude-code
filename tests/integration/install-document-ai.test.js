/**
 * Integration tests for the `document-ai` profile.
 *
 * Asserts:
 *   - Plan document carries the declared safety settings (dry-run required,
 *     MCP not allowed) through to the `safety` block.
 *   - All operation destinations sit inside the resolved targetRoot, and the
 *     adapter declares them as inside allowedRoots.
 *   - Running install end-to-end writes an install-state file that includes
 *     `settings.require_audit_log === true` from the profile.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  resolveInstallPlan,
} = require('../../scripts/lib/install-manifests');
const { buildPlanDocument } = require('../../scripts/lib/install/plan-operations');
const {
  getInstallTargetAdapter,
} = require('../../scripts/lib/install-targets/registry');
const {
  applyInstallPlan,
  createManifestInstallPlan,
} = require('../../scripts/lib/install-executor');
const { readInstallState } = require('../../scripts/lib/install-state');

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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'install-document-ai-'));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function runTests() {
  console.log('\n=== Testing document-ai profile install plan ===\n');

  let passed = 0;
  let failed = 0;

  if (test('plan document carries safety flags from document-ai settings', () => {
    const tmp = createTempDir();
    try {
      const resolved = resolveInstallPlan({
        profileId: 'document-ai',
        target: 'claude',
        homeDir: tmp,
        projectRoot: tmp,
      });
      const adapter = getInstallTargetAdapter('claude');
      const plan = buildPlanDocument(resolved, adapter, {
        planningInput: {
          homeDir: tmp,
          projectRoot: tmp,
          targetRoot: resolved.targetRoot,
        },
        profileSettings: resolved.profileSettings,
      });

      assert.strictEqual(plan.safety.dryRunRequired, true, 'expected dryRunRequired:true');
      assert.strictEqual(plan.safety.mcpAllowed, false, 'expected mcpAllowed:false');
      assert.strictEqual(
        plan.safety.allDestinationsInsideAllowedRoots,
        true,
        'expected all destinations inside allowed roots'
      );
    } finally {
      cleanup(tmp);
    }
  })) passed++; else failed++;

  if (test('all operations sit under the resolved targetRoot', () => {
    const tmp = createTempDir();
    try {
      const resolved = resolveInstallPlan({
        profileId: 'document-ai',
        target: 'claude',
        homeDir: tmp,
        projectRoot: tmp,
      });
      const targetRoot = resolved.targetRoot;
      assert.ok(targetRoot, 'expected resolved targetRoot');
      for (const op of resolved.operations) {
        // Operations must originate within targetRoot.
        const insideRoot =
          op.destinationPath === targetRoot
          || op.destinationPath.startsWith(targetRoot + path.sep);
        assert.ok(
          insideRoot,
          `operation destination ${op.destinationPath} not under targetRoot ${targetRoot}`
        );
      }
    } finally {
      cleanup(tmp);
    }
  })) passed++; else failed++;

  if (test('apply persists settings.require_audit_log:true into install-state', () => {
    const tmp = createTempDir();
    try {
      const plan = createManifestInstallPlan({
        profileId: 'document-ai',
        target: 'claude',
        homeDir: tmp,
        projectRoot: tmp,
      });

      // Adapter must be a full adapter for apply.js (it calls allowedRoots()).
      const adapter = getInstallTargetAdapter('claude');
      const applyPlan = {
        ...plan,
        adapter,
        homeDir: tmp,
        projectRoot: tmp,
      };

      applyInstallPlan(applyPlan);

      const state = readInstallState(plan.installStatePath);
      assert.ok(state, 'install-state should be readable');
      assert.ok(state.settings, 'install-state.settings should exist');
      assert.strictEqual(
        state.settings.require_audit_log,
        true,
        'expected settings.require_audit_log:true'
      );
      // Audit-log file should also have been written since require_audit_log:true.
      const auditPath = path.join(tmp, '.claude', 'ecc', 'audit.jsonl');
      assert.ok(fs.existsSync(auditPath), 'audit.jsonl should exist');
    } finally {
      cleanup(tmp);
    }
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
