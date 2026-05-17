'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  STATES,
  ALLOWED_FORWARD,
  isKnownState,
  validateTransition,
  applyTransition,
} = require('../../../scripts/lib/install/lifecycle-transitions');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    if (err.stack) console.log(err.stack.split('\n').slice(1, 5).join('\n'));
    failed++;
  }
}

function createTmpManifest(seed) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-test-'));
  const file = path.join(dir, 'install-profiles.json');
  fs.writeFileSync(file, JSON.stringify(seed, null, 2) + '\n', 'utf8');
  return { dir, file };
}

function cleanupTmp(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
}

function baselineManifest() {
  return {
    version: 1,
    profiles: {
      minimal: {
        description: 'Minimal',
        modules: ['rules-core'],
        targets: ['claude'],
        settings: {
          scope: 'project',
          allow_mcp: false,
          lifecycle: 'draft',
        },
      },
      other: {
        description: 'Other',
        modules: ['rules-core'],
        targets: ['claude'],
        settings: {
          scope: 'project',
          lifecycle: 'candidate',
        },
      },
    },
  };
}

console.log('\n=== lifecycle-transitions ===\n');

test('STATES and ALLOWED_FORWARD shape', () => {
  assert.deepStrictEqual(STATES, ['draft', 'candidate', 'promoted']);
  assert.deepStrictEqual(ALLOWED_FORWARD.draft, ['candidate']);
  assert.deepStrictEqual(ALLOWED_FORWARD.candidate, ['promoted']);
  assert.deepStrictEqual(ALLOWED_FORWARD.promoted, []);
  assert.strictEqual(isKnownState('draft'), true);
  assert.strictEqual(isKnownState('nope'), false);
});

test('validateTransition forward draft->candidate is allowed', () => {
  const r = validateTransition('draft', 'candidate');
  assert.strictEqual(r.allowed, true);
  assert.strictEqual(r.reason, 'forward');
});

test('validateTransition forward candidate->promoted is allowed', () => {
  const r = validateTransition('candidate', 'promoted');
  assert.strictEqual(r.allowed, true);
  assert.strictEqual(r.reason, 'forward');
});

test('validateTransition promoted->candidate refused without --force', () => {
  const r = validateTransition('promoted', 'candidate');
  assert.strictEqual(r.allowed, false);
  assert.ok(r.reason.includes('--force'), `unexpected reason: ${r.reason}`);
});

test('validateTransition promoted->candidate allowed with --force', () => {
  const r = validateTransition('promoted', 'candidate', { force: true });
  assert.strictEqual(r.allowed, true);
  assert.strictEqual(r.reason, 'forced');
});

test('validateTransition draft->promoted refused without --force (skip-ahead)', () => {
  const r = validateTransition('draft', 'promoted');
  assert.strictEqual(r.allowed, false);
  assert.ok(r.reason.includes('--force'), `unexpected reason: ${r.reason}`);
});

test('validateTransition idempotent same-state allowed', () => {
  const r = validateTransition('draft', 'draft');
  assert.strictEqual(r.allowed, true);
  assert.strictEqual(r.reason, 'idempotent');
});

test('validateTransition unknown source refused', () => {
  const r = validateTransition('mystery', 'candidate');
  assert.strictEqual(r.allowed, false);
  assert.ok(r.reason.includes('unknown source'));
});

test('validateTransition unknown target refused', () => {
  const r = validateTransition('draft', 'archived');
  assert.strictEqual(r.allowed, false);
  assert.ok(r.reason.includes('unknown target'));
});

test('applyTransition writes manifest with lifecycle bumped', () => {
  const { dir, file } = createTmpManifest(baselineManifest());
  try {
    const result = applyTransition(file, 'minimal', 'candidate');
    assert.strictEqual(result.applied, true);
    assert.strictEqual(result.from, 'draft');
    assert.strictEqual(result.to, 'candidate');
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.strictEqual(onDisk.profiles.minimal.settings.lifecycle, 'candidate');
  } finally {
    cleanupTmp(dir);
  }
});

test('applyTransition with dryRun does NOT write', () => {
  const { dir, file } = createTmpManifest(baselineManifest());
  try {
    const before = fs.readFileSync(file, 'utf8');
    const result = applyTransition(file, 'minimal', 'candidate', { dryRun: true });
    assert.strictEqual(result.applied, false);
    assert.strictEqual(result.from, 'draft');
    assert.strictEqual(result.to, 'candidate');
    const after = fs.readFileSync(file, 'utf8');
    assert.strictEqual(before, after, 'file should not be mutated in dry-run');
  } finally {
    cleanupTmp(dir);
  }
});

test('applyTransition on unknown profile throws', () => {
  const { dir, file } = createTmpManifest(baselineManifest());
  try {
    assert.throws(
      () => applyTransition(file, 'does-not-exist', 'candidate'),
      /profile not found/,
    );
  } finally {
    cleanupTmp(dir);
  }
});

test('applyTransition preserves other profile fields and other profiles', () => {
  const { dir, file } = createTmpManifest(baselineManifest());
  try {
    const before = JSON.parse(fs.readFileSync(file, 'utf8'));
    const otherBefore = JSON.parse(JSON.stringify(before.profiles.other));
    const minimalDescription = before.profiles.minimal.description;
    const minimalModules = before.profiles.minimal.modules.slice();
    const minimalScope = before.profiles.minimal.settings.scope;

    applyTransition(file, 'minimal', 'candidate');

    const after = JSON.parse(fs.readFileSync(file, 'utf8'));
    // Other profile untouched
    assert.deepStrictEqual(after.profiles.other, otherBefore);
    // Minimal profile: only lifecycle changed
    assert.strictEqual(after.profiles.minimal.description, minimalDescription);
    assert.deepStrictEqual(after.profiles.minimal.modules, minimalModules);
    assert.strictEqual(after.profiles.minimal.settings.scope, minimalScope);
    assert.strictEqual(after.profiles.minimal.settings.allow_mcp, false);
    assert.strictEqual(after.profiles.minimal.settings.lifecycle, 'candidate');
    // Top-level keys preserved
    assert.strictEqual(after.version, 1);
  } finally {
    cleanupTmp(dir);
  }
});

test('applyTransition refuses backward without --force, accepts with --force', () => {
  const seed = baselineManifest();
  seed.profiles.minimal.settings.lifecycle = 'promoted';
  const { dir, file } = createTmpManifest(seed);
  try {
    assert.throws(() => applyTransition(file, 'minimal', 'candidate'), /requires --force/);
    const onDiskAfterThrow = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.strictEqual(onDiskAfterThrow.profiles.minimal.settings.lifecycle, 'promoted',
      'manifest should not be mutated on refused transition');
    const result = applyTransition(file, 'minimal', 'candidate', { force: true });
    assert.strictEqual(result.applied, true);
    assert.strictEqual(result.reason, 'forced');
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.strictEqual(onDisk.profiles.minimal.settings.lifecycle, 'candidate');
  } finally {
    cleanupTmp(dir);
  }
});

test('applyTransition idempotent (draft -> draft) does not error and writes same state', () => {
  const { dir, file } = createTmpManifest(baselineManifest());
  try {
    const result = applyTransition(file, 'minimal', 'draft');
    assert.strictEqual(result.applied, true);
    assert.strictEqual(result.reason, 'idempotent');
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.strictEqual(onDisk.profiles.minimal.settings.lifecycle, 'draft');
  } finally {
    cleanupTmp(dir);
  }
});

test('applyTransition rejects invalid manifestPath / profileId / state', () => {
  assert.throws(() => applyTransition('', 'minimal', 'candidate'), /manifestPath/);
  assert.throws(() => applyTransition('/tmp/x.json', '', 'candidate'), /profileId/);
  const { dir, file } = createTmpManifest(baselineManifest());
  try {
    assert.throws(() => applyTransition(file, 'minimal', 'archived'), /unknown target/);
  } finally {
    cleanupTmp(dir);
  }
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
