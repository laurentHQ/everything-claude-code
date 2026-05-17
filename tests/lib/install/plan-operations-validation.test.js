/**
 * Tests for Wave 0 (I3): runtime AJV validation of plan documents.
 *
 * buildPlanDocument now validates its output against
 * schemas/install-plan.schema.json and throws on mismatch. This test asserts:
 *   - A normally-built plan passes the validator on construction.
 *   - The standalone `assertPlanDocumentValid` helper catches a hand-mutated
 *     invalid plan (here: setting an invalid `conflicts[0].reason`).
 */

'use strict';

const assert = require('assert');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');

const {
  buildPlanDocument,
  assertPlanDocumentValid,
} = require(path.join(REPO_ROOT, 'scripts', 'lib', 'install', 'plan-operations'));

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

function makeOp(moduleId, destinationPath, kind = 'copy-file') {
  return {
    kind,
    moduleId,
    sourceRelativePath: `src/${moduleId}/${path.basename(destinationPath)}`,
    sourcePath: `/repo/src/${moduleId}/${path.basename(destinationPath)}`,
    destinationPath,
    strategy: 'overwrite',
  };
}

function makeResolvedRequest() {
  return {
    profileId: 'minimal',
    target: 'claude',
    selectedModuleIds: ['rules-core'],
    operations: [makeOp('rules-core', '/tmp/claude/rules/x.md')],
    profileSettings: {
      require_dry_run_first: false,
      allow_mcp: false,
      block_global_install: false,
    },
  };
}

function runTests() {
  console.log('\n=== Wave 0 / I3: buildPlanDocument runtime schema validation ===\n');

  let passed = 0;
  let failed = 0;

  if (test('buildPlanDocument output validates on first construction', () => {
    const doc = buildPlanDocument(makeResolvedRequest(), null, {
      scope: 'project',
      repoVersion: '1.0.0',
    });
    // If buildPlanDocument did not throw, validation passed. Sanity-check
    // through the exported helper too.
    assert.doesNotThrow(() => assertPlanDocumentValid(doc));
  })) passed++; else failed++;

  if (test('assertPlanDocumentValid catches a mutated plan with invalid conflicts[].reason', () => {
    const doc = buildPlanDocument(makeResolvedRequest(), null, {
      scope: 'project',
      repoVersion: '1.0.0',
    });
    // Mutate the document to inject an invalid `reason` (not in enum) and a
    // valid severity. The schema's conflicts[].reason enum should reject it.
    doc.conflicts.push({
      destination: '/tmp/claude/rules/x.md',
      moduleId: 'rules-core',
      reason: 'not-a-real-reason',
      severity: 'error',
    });
    let caught = null;
    try {
      assertPlanDocumentValid(doc);
    } catch (error) {
      caught = error;
    }
    assert.ok(caught, 'assertPlanDocumentValid should throw on invalid conflicts[].reason');
    assert.ok(
      /does not match schemas\/install-plan\.schema\.json/.test(caught.message),
      `error message should mention the schema path, got: ${caught.message}`
    );
  })) passed++; else failed++;

  if (test('assertPlanDocumentValid catches an invalid operations[].kind', () => {
    const doc = buildPlanDocument(makeResolvedRequest(), null, {
      scope: 'project',
      repoVersion: '1.0.0',
    });
    // Replace the kind with a value outside the install-operations enum.
    doc.operations[0].kind = 'symlink';
    let caught = null;
    try {
      assertPlanDocumentValid(doc);
    } catch (error) {
      caught = error;
    }
    assert.ok(caught, 'assertPlanDocumentValid should throw on unknown operations[].kind');
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
