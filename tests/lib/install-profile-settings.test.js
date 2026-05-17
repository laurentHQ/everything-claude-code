/**
 * Tests for profile settings schema + CI semantic checks.
 *
 * Covers:
 *  - Real manifests/install-profiles.json validates against the extended schema.
 *  - Synthetic profiles exercise the semantic checks in
 *    scripts/ci/validate-install-manifests.js (allow_mcp, block_global_install,
 *    hook_profile:validation).
 *  - Schema rejects unknown settings keys and out-of-enum values.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');

const REPO_ROOT = path.resolve(__dirname, '../..');
const PROFILES_SCHEMA_PATH = path.join(REPO_ROOT, 'schemas/install-profiles.schema.json');
const PROFILES_MANIFEST_PATH = path.join(REPO_ROOT, 'manifests/install-profiles.json');

const {
  runProfileSettingsSemanticChecks,
} = require('../../scripts/ci/validate-install-manifests');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function buildValidator() {
  const ajv = new Ajv({ allErrors: true });
  const schema = readJson(PROFILES_SCHEMA_PATH);
  return ajv.compile(schema);
}

function makeProfilesDoc(profiles) {
  return { version: 1, profiles };
}

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

function runTests() {
  console.log('\n=== Testing install-profile-settings (schema + CI semantics) ===\n');

  let passed = 0;
  let failed = 0;

  if (test('real install-profiles.json validates against the extended schema', () => {
    const validate = buildValidator();
    const data = readJson(PROFILES_MANIFEST_PATH);
    const ok = validate(data);
    assert.ok(ok, `Expected real manifest to validate. Errors: ${JSON.stringify(validate.errors)}`);
  })) passed++; else failed++;

  if (test('real install-profiles.json passes semantic CI checks', () => {
    const data = readJson(PROFILES_MANIFEST_PATH);
    const errors = runProfileSettingsSemanticChecks(data);
    assert.deepStrictEqual(errors, [], `Expected no semantic errors. Got: ${errors.join('\n')}`);
  })) passed++; else failed++;

  if (test('schema rejects profile with unknown settings key', () => {
    const validate = buildValidator();
    const doc = makeProfilesDoc({
      bad: {
        description: 'has unknown setting',
        modules: ['rules-core'],
        settings: { not_a_real_key: true },
      },
    });
    const ok = validate(doc);
    assert.strictEqual(ok, false, 'Schema should reject unknown settings key');
  })) passed++; else failed++;

  if (test('schema rejects settings.scope out of enum', () => {
    const validate = buildValidator();
    const doc = makeProfilesDoc({
      bad: {
        description: 'bad scope',
        modules: ['rules-core'],
        settings: { scope: 'invalid' },
      },
    });
    const ok = validate(doc);
    assert.strictEqual(ok, false, 'Schema should reject scope:invalid');
  })) passed++; else failed++;

  if (test('schema rejects targets entry not in enum', () => {
    const validate = buildValidator();
    const doc = makeProfilesDoc({
      bad: {
        description: 'bad target',
        modules: ['rules-core'],
        targets: ['claude', 'mystery'],
      },
    });
    const ok = validate(doc);
    assert.strictEqual(ok, false, 'Schema should reject unknown target');
  })) passed++; else failed++;

  if (test('schema accepts profile with no settings at all', () => {
    const validate = buildValidator();
    const doc = makeProfilesDoc({
      bare: {
        description: 'no settings',
        modules: ['rules-core'],
      },
    });
    const ok = validate(doc);
    assert.ok(ok, `Expected to pass. Errors: ${JSON.stringify(validate.errors)}`);
  })) passed++; else failed++;

  if (test('schema accepts settings.lifecycle: candidate', () => {
    const validate = buildValidator();
    const doc = makeProfilesDoc({
      ok: {
        description: 'candidate',
        modules: ['rules-core'],
        settings: { lifecycle: 'candidate', hook_profile: 'standard' },
      },
    });
    const ok = validate(doc);
    assert.ok(ok, `Expected to pass. Errors: ${JSON.stringify(validate.errors)}`);
    const errors = runProfileSettingsSemanticChecks(doc);
    assert.deepStrictEqual(errors, []);
  })) passed++; else failed++;

  if (test('semantic check rejects allow_mcp:true with empty allowed_mcp_servers', () => {
    const doc = makeProfilesDoc({
      mcp: {
        description: 'mcp empty',
        modules: ['rules-core'],
        settings: { allow_mcp: true, allowed_mcp_servers: [] },
      },
    });
    const errors = runProfileSettingsSemanticChecks(doc);
    assert.strictEqual(errors.length, 1, `Expected one error. Got: ${JSON.stringify(errors)}`);
    assert.match(errors[0], /allow_mcp:true requires non-empty allowed_mcp_servers/);
    assert.match(errors[0], /Profile mcp/);
  })) passed++; else failed++;

  if (test('semantic check rejects allow_mcp:true with missing allowed_mcp_servers', () => {
    const doc = makeProfilesDoc({
      mcp: {
        description: 'mcp missing',
        modules: ['rules-core'],
        settings: { allow_mcp: true },
      },
    });
    const errors = runProfileSettingsSemanticChecks(doc);
    assert.strictEqual(errors.length, 1);
    assert.match(errors[0], /non-empty allowed_mcp_servers/);
  })) passed++; else failed++;

  if (test('semantic check accepts allow_mcp:true with non-empty allowed_mcp_servers', () => {
    const doc = makeProfilesDoc({
      mcp: {
        description: 'mcp allowed',
        modules: ['rules-core'],
        settings: { allow_mcp: true, allowed_mcp_servers: ['context7'] },
      },
    });
    const errors = runProfileSettingsSemanticChecks(doc);
    assert.deepStrictEqual(errors, []);
  })) passed++; else failed++;

  if (test('semantic check rejects block_global_install:true with scope:user', () => {
    const doc = makeProfilesDoc({
      block: {
        description: 'incompatible',
        modules: ['rules-core'],
        settings: { block_global_install: true, scope: 'user' },
      },
    });
    const errors = runProfileSettingsSemanticChecks(doc);
    assert.strictEqual(errors.length, 1);
    assert.match(errors[0], /block_global_install:true is incompatible with scope:user/);
    assert.match(errors[0], /Profile block/);
  })) passed++; else failed++;

  if (test('semantic check accepts block_global_install:true with scope:project', () => {
    const doc = makeProfilesDoc({
      ok: {
        description: 'ok',
        modules: ['rules-core'],
        settings: { block_global_install: true, scope: 'project' },
      },
    });
    const errors = runProfileSettingsSemanticChecks(doc);
    assert.deepStrictEqual(errors, []);
  })) passed++; else failed++;

  if (test('semantic check rejects hook_profile:validation without require_audit_log:true', () => {
    const doc = makeProfilesDoc({
      val: {
        description: 'val',
        modules: ['rules-core'],
        settings: { hook_profile: 'validation' },
      },
    });
    const errors = runProfileSettingsSemanticChecks(doc);
    assert.strictEqual(errors.length, 1);
    assert.match(errors[0], /hook_profile:validation requires require_audit_log:true/);
  })) passed++; else failed++;

  if (test('semantic check rejects hook_profile:validation with require_audit_log:false', () => {
    const doc = makeProfilesDoc({
      val: {
        description: 'val',
        modules: ['rules-core'],
        settings: { hook_profile: 'validation', require_audit_log: false },
      },
    });
    const errors = runProfileSettingsSemanticChecks(doc);
    assert.strictEqual(errors.length, 1);
  })) passed++; else failed++;

  if (test('semantic check accepts hook_profile:validation with require_audit_log:true', () => {
    const doc = makeProfilesDoc({
      val: {
        description: 'val',
        modules: ['rules-core'],
        settings: { hook_profile: 'validation', require_audit_log: true },
      },
    });
    const errors = runProfileSettingsSemanticChecks(doc);
    assert.deepStrictEqual(errors, []);
  })) passed++; else failed++;

  if (test('semantic check skips profiles without settings', () => {
    const doc = makeProfilesDoc({
      bare: {
        description: 'bare',
        modules: ['rules-core'],
      },
    });
    const errors = runProfileSettingsSemanticChecks(doc);
    assert.deepStrictEqual(errors, []);
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
