/**
 * Tests that `scripts/install-plan.js --profile <p> --target <t> --json`
 * emits a document that validates against schemas/install-plan.schema.json.
 *
 * The schema is the contract; this test pins the CLI surface to it.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const Ajv = require('ajv');

const REPO_ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'install-plan.js');
const SCHEMA_PATH = path.join(REPO_ROOT, 'schemas/install-plan.schema.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function buildValidator() {
  const ajv = new Ajv({ allErrors: true });
  return ajv.compile(readJson(SCHEMA_PATH));
}

function run(args) {
  const result = spawnSync('node', [SCRIPT, ...args], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 15000,
  });
  return {
    code: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
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
  console.log('\n=== Testing scripts/install-plan.js --json schema conformance ===\n');

  let passed = 0;
  let failed = 0;

  if (test('--profile minimal --target claude --json validates against install-plan.schema.json', () => {
    const result = run(['--profile', 'minimal', '--target', 'claude', '--json']);
    assert.strictEqual(result.code, 0, `Non-zero exit. stderr: ${result.stderr}`);
    let doc;
    try {
      doc = JSON.parse(result.stdout);
    } catch (e) {
      throw new Error(`stdout was not valid JSON: ${e.message}\n${result.stdout.slice(0, 400)}`);
    }
    const validate = buildValidator();
    const ok = validate(doc);
    assert.ok(ok, `Schema validation failed: ${JSON.stringify(validate.errors, null, 2)}`);
    assert.strictEqual(doc.tool, 'ecc');
    assert.strictEqual(doc.profileId, 'minimal');
    assert.strictEqual(doc.target, 'claude');
    assert.ok(Array.isArray(doc.modules));
    assert.ok(doc.modules.length > 0);
    assert.ok(Array.isArray(doc.operations));
    assert.ok(doc.operations.length > 0);
  })) passed++; else failed++;

  if (test('--profile core --target cursor --json validates against install-plan.schema.json', () => {
    const result = run(['--profile', 'core', '--target', 'cursor', '--json']);
    assert.strictEqual(result.code, 0, `Non-zero exit. stderr: ${result.stderr}`);
    const doc = JSON.parse(result.stdout);
    const validate = buildValidator();
    const ok = validate(doc);
    assert.ok(ok, `Schema validation failed: ${JSON.stringify(validate.errors, null, 2)}`);
    assert.strictEqual(doc.target, 'cursor');
  })) passed++; else failed++;

  if (test('operations are sorted by (moduleId, destinationPath)', () => {
    const result = run(['--profile', 'minimal', '--target', 'claude', '--json']);
    const doc = JSON.parse(result.stdout);
    const ops = doc.operations;
    for (let i = 1; i < ops.length; i += 1) {
      const prev = `${ops[i - 1].moduleId} ${ops[i - 1].destinationPath}`;
      const cur = `${ops[i].moduleId} ${ops[i].destinationPath}`;
      assert.ok(prev <= cur, `Operations not sorted at index ${i}: "${prev}" should be <= "${cur}"`);
    }
  })) passed++; else failed++;

  if (test('safety block contains all required keys', () => {
    const result = run(['--profile', 'minimal', '--target', 'claude', '--json']);
    const doc = JSON.parse(result.stdout);
    assert.deepStrictEqual(
      Object.keys(doc.safety).sort(),
      [
        'allDestinationsInsideAllowedRoots',
        'dryRunRequired',
        'globalInstallAllowed',
        'mcpAllowed',
      ]
    );
    // The minimal profile has require_dry_run_first: true (per current manifest).
    assert.strictEqual(doc.safety.dryRunRequired, true);
  })) passed++; else failed++;

  if (test('--json without --target keeps legacy shape (backwards compat)', () => {
    const result = run(['--profile', 'minimal', '--json']);
    assert.strictEqual(result.code, 0);
    const doc = JSON.parse(result.stdout);
    // Legacy fields should still appear.
    assert.ok('selectedModuleIds' in doc, 'Expected legacy selectedModuleIds when --target omitted');
    assert.strictEqual(doc.tool, undefined, 'Legacy shape has no "tool" field');
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
