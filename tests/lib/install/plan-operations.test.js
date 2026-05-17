/**
 * Tests for scripts/lib/install/plan-operations.js
 *
 * Covers:
 *  - sortOperations deterministic ordering and idempotence
 *  - buildOperations returns a copy (no mutation)
 *  - buildPlanDocument validates against schemas/install-plan.schema.json
 *  - byte-identical determinism of stringified output
 *  - conflicts emission for outside-allowed-root destinations
 *  - safety block reflects profile settings
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SCHEMA_PATH = path.join(REPO_ROOT, 'schemas/install-plan.schema.json');
const OPERATIONS_SCHEMA_PATH = path.join(REPO_ROOT, 'schemas/install-operations.schema.json');

const {
  sortOperations,
  buildOperations,
  buildPlanDocument,
} = require('../../../scripts/lib/install/plan-operations');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function buildValidator() {
  const ajv = new Ajv({ allErrors: true });
  ajv.addSchema(readJson(OPERATIONS_SCHEMA_PATH));
  return ajv.compile(readJson(SCHEMA_PATH));
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

// Use posix-style absolute paths in fixtures so the schema-level checks
// and allowed-root comparisons are platform-stable.
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

function runTests() {
  console.log('\n=== Testing scripts/lib/install/plan-operations ===\n');

  let passed = 0;
  let failed = 0;

  if (test('sortOperations sorts by moduleId then destinationPath ASCII', () => {
    const ops = [
      makeOp('b-mod', '/tmp/a.txt'),
      makeOp('a-mod', '/tmp/b.txt'),
      makeOp('a-mod', '/tmp/a.txt'),
      makeOp('b-mod', '/tmp/b.txt'),
    ];
    sortOperations(ops);
    assert.deepStrictEqual(
      ops.map(o => [o.moduleId, o.destinationPath]),
      [
        ['a-mod', '/tmp/a.txt'],
        ['a-mod', '/tmp/b.txt'],
        ['b-mod', '/tmp/a.txt'],
        ['b-mod', '/tmp/b.txt'],
      ]
    );
  })) passed++; else failed++;

  if (test('sortOperations is idempotent', () => {
    const ops = [
      makeOp('a', '/x'),
      makeOp('a', '/y'),
      makeOp('b', '/x'),
    ];
    sortOperations(ops);
    const first = ops.map(o => `${o.moduleId}|${o.destinationPath}`);
    sortOperations(ops);
    const second = ops.map(o => `${o.moduleId}|${o.destinationPath}`);
    assert.deepStrictEqual(first, second);
  })) passed++; else failed++;

  if (test('sortOperations handles non-array gracefully', () => {
    assert.deepStrictEqual(sortOperations(null), []);
    assert.deepStrictEqual(sortOperations(undefined), []);
    assert.deepStrictEqual(sortOperations('nope'), []);
  })) passed++; else failed++;

  if (test('buildOperations returns a new array (input not mutated)', () => {
    const input = {
      operations: [
        makeOp('b', '/tmp/b.txt'),
        makeOp('a', '/tmp/a.txt'),
      ],
    };
    const original = input.operations.slice();
    const out = buildOperations(input, null);
    assert.notStrictEqual(out, input.operations, 'buildOperations must return a new array');
    // Input array order unchanged.
    assert.deepStrictEqual(input.operations, original);
    // Output is sorted.
    assert.deepStrictEqual(out.map(o => o.moduleId), ['a', 'b']);
  })) passed++; else failed++;

  if (test('buildPlanDocument output validates against install-plan.schema.json', () => {
    const validate = buildValidator();
    const doc = buildPlanDocument(
      {
        profileId: 'minimal',
        target: 'claude',
        selectedModuleIds: ['rules-core', 'agents-core'],
        operations: [makeOp('rules-core', '/tmp/claude/rules/x.md')],
        profileSettings: {
          require_dry_run_first: true,
          allow_mcp: false,
          block_global_install: false,
        },
      },
      null,
      { scope: 'project', repoVersion: '1.2.3' }
    );
    const ok = validate(doc);
    assert.ok(ok, `Expected document to validate. Errors: ${JSON.stringify(validate.errors)}`);
  })) passed++; else failed++;

  if (test('buildPlanDocument is deterministic (byte-identical JSON.stringify)', () => {
    const input = {
      profileId: 'minimal',
      target: 'claude',
      selectedModuleIds: ['agents-core', 'rules-core'],
      operations: [
        makeOp('rules-core', '/tmp/claude/rules/z.md'),
        makeOp('agents-core', '/tmp/claude/agents/a.md'),
        makeOp('rules-core', '/tmp/claude/rules/a.md'),
      ],
      profileSettings: { require_dry_run_first: true },
    };
    const a = JSON.stringify(buildPlanDocument(input, null, { scope: 'project' }), null, 2);
    const b = JSON.stringify(buildPlanDocument(input, null, { scope: 'project' }), null, 2);
    assert.strictEqual(a, b);
    // Operations sorted as expected within the document.
    const parsed = JSON.parse(a);
    assert.deepStrictEqual(
      parsed.operations.map(o => `${o.moduleId}|${o.destinationPath}`),
      [
        'agents-core|/tmp/claude/agents/a.md',
        'rules-core|/tmp/claude/rules/a.md',
        'rules-core|/tmp/claude/rules/z.md',
      ]
    );
  })) passed++; else failed++;

  if (test('conflicts include outside-allowed-root entry when destination escapes roots', () => {
    // Use /tmp as the allowed root. Then add an operation that writes to /etc.
    const adapter = {
      allowedRoots() {
        return ['/tmp'];
      },
    };
    const doc = buildPlanDocument(
      {
        profileId: 'p',
        target: 't',
        selectedModuleIds: ['m'],
        operations: [
          makeOp('m', '/tmp/ok/file.txt'),
          makeOp('m', '/etc/escape.txt'),
        ],
      },
      adapter,
      { scope: 'project' }
    );
    assert.strictEqual(doc.conflicts.length, 1, `Expected exactly 1 conflict, got ${JSON.stringify(doc.conflicts)}`);
    assert.strictEqual(doc.conflicts[0].reason, 'outside-allowed-root');
    assert.strictEqual(doc.conflicts[0].destination, '/etc/escape.txt');
    assert.strictEqual(doc.conflicts[0].severity, 'error');
    assert.strictEqual(doc.safety.allDestinationsInsideAllowedRoots, false);
  })) passed++; else failed++;

  if (test('empty allowedRoots → safety.allDestinationsInsideAllowedRoots=true with no conflicts', () => {
    const adapter = { allowedRoots() { return []; } };
    const doc = buildPlanDocument(
      {
        profileId: 'p',
        target: 't',
        selectedModuleIds: ['m'],
        operations: [
          makeOp('m', '/anywhere/at/all.txt'),
          makeOp('m', '/etc/passwd-not-really'),
        ],
      },
      adapter,
      {}
    );
    assert.strictEqual(doc.conflicts.length, 0);
    assert.strictEqual(doc.safety.allDestinationsInsideAllowedRoots, true);
  })) passed++; else failed++;

  if (test('no adapter at all → safety.allDestinationsInsideAllowedRoots=true with no conflicts', () => {
    const doc = buildPlanDocument(
      {
        profileId: 'p',
        target: 't',
        selectedModuleIds: ['m'],
        operations: [makeOp('m', '/wherever/file.txt')],
      },
      null,
      {}
    );
    assert.strictEqual(doc.conflicts.length, 0);
    assert.strictEqual(doc.safety.allDestinationsInsideAllowedRoots, true);
  })) passed++; else failed++;

  if (test('safety reflects profile settings', () => {
    const doc = buildPlanDocument(
      {
        profileId: 'p',
        target: 't',
        selectedModuleIds: [],
        operations: [],
        profileSettings: {
          require_dry_run_first: true,
          allow_mcp: true,
          block_global_install: true,
        },
      },
      null,
      {}
    );
    assert.strictEqual(doc.safety.dryRunRequired, true);
    assert.strictEqual(doc.safety.mcpAllowed, true);
    assert.strictEqual(doc.safety.globalInstallAllowed, false);
  })) passed++; else failed++;

  if (test('safety defaults when profile settings absent', () => {
    const doc = buildPlanDocument(
      {
        profileId: null,
        target: 't',
        selectedModuleIds: [],
        operations: [],
      },
      null,
      {}
    );
    assert.strictEqual(doc.safety.dryRunRequired, false);
    assert.strictEqual(doc.safety.mcpAllowed, false);
    assert.strictEqual(doc.safety.globalInstallAllowed, true);
    assert.strictEqual(doc.safety.allDestinationsInsideAllowedRoots, true);
  })) passed++; else failed++;

  if (test('document top-level shape contains exactly the schema-required keys', () => {
    const doc = buildPlanDocument(
      { profileId: 'p', target: 't', selectedModuleIds: [], operations: [] },
      null,
      {}
    );
    assert.deepStrictEqual(
      Object.keys(doc),
      [
        'tool',
        'version',
        'profileId',
        'target',
        'scope',
        'modules',
        'operations',
        'conflicts',
        'warnings',
        'safety',
      ]
    );
    assert.strictEqual(doc.tool, 'ecc');
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
