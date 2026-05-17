/**
 * Integration tests for the `enterprise` profile.
 *
 * Asserts:
 *   - safety.mcpAllowed === true (enterprise allows MCP).
 *   - safety.globalInstallAllowed === true (block_global_install:false).
 *   - The emitted plan validates against schemas/install-plan.schema.json.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Ajv = require('ajv');

const { resolveInstallPlan } = require('../../scripts/lib/install-manifests');
const { buildPlanDocument } = require('../../scripts/lib/install/plan-operations');
const { getInstallTargetAdapter } = require('../../scripts/lib/install-targets/registry');

const REPO_ROOT = path.join(__dirname, '../..');
const SCHEMA_PATH = path.join(REPO_ROOT, 'schemas', 'install-plan.schema.json');

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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'install-enterprise-'));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function buildEnterprisePlan(tmp) {
  const resolved = resolveInstallPlan({
    profileId: 'enterprise',
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
  console.log('\n=== Testing enterprise profile install plan ===\n');

  let passed = 0;
  let failed = 0;

  if (test('safety.mcpAllowed === true for enterprise', () => {
    const tmp = createTempDir();
    try {
      const plan = buildEnterprisePlan(tmp);
      assert.strictEqual(plan.safety.mcpAllowed, true);
    } finally {
      cleanup(tmp);
    }
  })) passed++; else failed++;

  if (test('safety.globalInstallAllowed === true for enterprise', () => {
    const tmp = createTempDir();
    try {
      const plan = buildEnterprisePlan(tmp);
      assert.strictEqual(plan.safety.globalInstallAllowed, true);
    } finally {
      cleanup(tmp);
    }
  })) passed++; else failed++;

  if (test('enterprise plan document validates against install-plan.schema.json', () => {
    const tmp = createTempDir();
    try {
      const plan = buildEnterprisePlan(tmp);
      const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
      const ajv = new Ajv({ allErrors: true });
      const validate = ajv.compile(schema);
      const valid = validate(plan);
      assert.ok(
        valid,
        `plan failed schema validation: ${JSON.stringify(validate.errors, null, 2)}`
      );
    } finally {
      cleanup(tmp);
    }
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
