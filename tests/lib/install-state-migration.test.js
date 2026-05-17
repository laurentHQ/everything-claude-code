/**
 * Tests for install-state v1 -> v2 migration and settings round-trip.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createInstallState,
  migrateInstallState,
  readInstallState,
  writeInstallState,
  SCHEMA_VERSION,
} = require('../../scripts/lib/install-state');

const CURRENT_PACKAGE_VERSION = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')
).version;

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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'install-state-migration-'));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function buildValidV1State() {
  return {
    schemaVersion: 'ecc.install.v1',
    installedAt: '2026-03-13T00:00:00Z',
    target: {
      id: 'claude-home',
      kind: 'home',
      root: '/home/u/.claude',
      installStatePath: '/home/u/.claude/ecc/install-state.json',
    },
    request: {
      profile: 'core',
      modules: [],
      includeComponents: [],
      excludeComponents: [],
      legacyLanguages: [],
      legacyMode: false,
    },
    resolution: {
      selectedModules: ['rules-core'],
      skippedModules: [],
    },
    source: {
      repoVersion: CURRENT_PACKAGE_VERSION,
      repoCommit: 'abc123',
      manifestVersion: 1,
    },
    operations: [],
  };
}

function runTests() {
  console.log('\n=== Testing install-state migration (v1 -> v2) ===\n');

  let passed = 0;
  let failed = 0;

  if (test('SCHEMA_VERSION is ecc.install.v2', () => {
    assert.strictEqual(SCHEMA_VERSION, 'ecc.install.v2');
  })) passed++; else failed++;

  if (test('readInstallState migrates a v1 file to v2 transparently', () => {
    const dir = createTempDir();
    try {
      const statePath = path.join(dir, 'install-state.json');
      const v1 = buildValidV1State();
      fs.writeFileSync(statePath, JSON.stringify(v1, null, 2));

      const loaded = readInstallState(statePath);
      assert.strictEqual(loaded.schemaVersion, 'ecc.install.v2');
      assert.strictEqual(loaded.target.id, 'claude-home');
      assert.strictEqual(loaded.request.profile, 'core');
      assert.deepStrictEqual(loaded.resolution.selectedModules, ['rules-core']);
      assert.strictEqual(loaded.source.repoCommit, 'abc123');
    } finally {
      cleanup(dir);
    }
  })) passed++; else failed++;

  if (test('migrateInstallState v1->v2 is a pure schemaVersion bump (no field injection)', () => {
    const v1 = buildValidV1State();
    const migrated = migrateInstallState(v1);
    // Migration must not inject v2-only optional fields (settings, backups).
    // Those land via createInstallState when callers opt in.
    assert.ok(!('settings' in migrated), 'settings must not be auto-injected by migration');
    assert.ok(!('backups' in migrated), 'backups must not be auto-injected by migration');
    // Every v1 key survives unchanged except schemaVersion.
    const expected = { ...v1, schemaVersion: 'ecc.install.v2' };
    assert.deepStrictEqual(migrated, expected);
    // Original input is not mutated.
    assert.strictEqual(v1.schemaVersion, 'ecc.install.v1');
  })) passed++; else failed++;

  if (test('migrateInstallState is idempotent on v2 input', () => {
    const v2Input = { ...buildValidV1State(), schemaVersion: 'ecc.install.v2' };
    const migrated = migrateInstallState(v2Input);
    assert.strictEqual(migrated, v2Input);
    assert.strictEqual(migrated.schemaVersion, 'ecc.install.v2');
  })) passed++; else failed++;

  if (test('migrateInstallState leaves unknown schemaVersion untouched (defers to validator)', () => {
    const input = { schemaVersion: 'ecc.install.v999', other: 'x' };
    const migrated = migrateInstallState(input);
    assert.strictEqual(migrated.schemaVersion, 'ecc.install.v999');
    assert.strictEqual(migrated.other, 'x');
  })) passed++; else failed++;

  if (test('readInstallState rejects unknown schemaVersion through validator', () => {
    const dir = createTempDir();
    try {
      const statePath = path.join(dir, 'install-state.json');
      fs.writeFileSync(statePath, JSON.stringify({ schemaVersion: 'wrong' }));
      assert.throws(() => readInstallState(statePath), /Invalid install-state/);
    } finally {
      cleanup(dir);
    }
  })) passed++; else failed++;

  if (test('migrateInstallState throws on null/array input', () => {
    assert.throws(() => migrateInstallState(null), /not a JSON object/);
    assert.throws(() => migrateInstallState([]), /not a JSON object/);
  })) passed++; else failed++;

  if (test('createInstallState writes settings round-trip through disk', () => {
    const dir = createTempDir();
    try {
      const statePath = path.join(dir, 'install-state.json');
      const state = createInstallState({
        adapter: { id: 'claude-home' },
        targetRoot: path.join(dir, '.claude'),
        installStatePath: statePath,
        request: {
          profile: 'strict-prof',
          modules: [],
          legacyLanguages: [],
          legacyMode: false,
        },
        resolution: {
          selectedModules: ['rules-core'],
          skippedModules: [],
        },
        operations: [],
        source: {
          repoVersion: CURRENT_PACKAGE_VERSION,
          repoCommit: 'abc123',
          manifestVersion: 1,
        },
        settings: {
          hook_profile: 'strict',
          require_audit_log: true,
          lifecycle: 'draft',
        },
      });

      assert.deepStrictEqual(state.settings, {
        hook_profile: 'strict',
        require_audit_log: true,
        lifecycle: 'draft',
      });

      writeInstallState(statePath, state);
      const loaded = readInstallState(statePath);
      assert.strictEqual(loaded.schemaVersion, 'ecc.install.v2');
      assert.deepStrictEqual(loaded.settings, {
        hook_profile: 'strict',
        require_audit_log: true,
        lifecycle: 'draft',
      });
    } finally {
      cleanup(dir);
    }
  })) passed++; else failed++;

  if (test('createInstallState omits settings field when none provided', () => {
    const state = createInstallState({
      adapter: { id: 'claude-home' },
      targetRoot: '/x',
      installStatePath: '/x/ecc/install-state.json',
      request: {
        profile: null,
        modules: [],
        legacyLanguages: [],
        legacyMode: false,
      },
      resolution: { selectedModules: [], skippedModules: [] },
      operations: [],
      source: { repoVersion: null, repoCommit: null, manifestVersion: 1 },
    });
    assert.ok(!('settings' in state), 'settings should be absent when not supplied');
    assert.ok(!('backups' in state), 'backups should be absent when not supplied');
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
