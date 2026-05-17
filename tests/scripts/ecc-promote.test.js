'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'ecc-promote.js');
const REAL_MANIFEST = path.join(REPO_ROOT, 'manifests', 'install-profiles.json');

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
    if (err.stack) console.log(err.stack.split('\n').slice(1, 4).join('\n'));
    failed++;
  }
}

function copyManifestToTmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-promote-test-'));
  const dst = path.join(dir, 'install-profiles.json');
  fs.copyFileSync(REAL_MANIFEST, dst);
  return { dir, manifestPath: dst };
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
}

function run(args) {
  const result = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8' });
  return {
    code: typeof result.status === 'number' ? result.status : 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

console.log('\n=== ecc-promote ===\n');

test('dry-run on draft profile prints "dry-run" and exits 0', () => {
  const { dir, manifestPath } = copyManifestToTmp();
  try {
    const before = fs.readFileSync(manifestPath, 'utf8');
    const r = run(['minimal', '--to', 'candidate', '--dry-run', '--manifest', manifestPath]);
    assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}; stderr: ${r.stderr}`);
    assert.ok(r.stdout.includes('dry-run'), `stdout should include "dry-run": ${r.stdout}`);
    const after = fs.readFileSync(manifestPath, 'utf8');
    assert.strictEqual(before, after, 'manifest must not be modified on --dry-run');
  } finally {
    cleanup(dir);
  }
});

test('invalid profile exits 1 with "profile not found" stderr', () => {
  const { dir, manifestPath } = copyManifestToTmp();
  try {
    const r = run(['ghost-profile', '--to', 'candidate', '--manifest', manifestPath]);
    assert.strictEqual(r.code, 1, `expected exit 1, got ${r.code}`);
    assert.ok(r.stderr.includes('profile not found'),
      `stderr should mention "profile not found": ${r.stderr}`);
  } finally {
    cleanup(dir);
  }
});

test('idempotent (--to draft on a draft profile) exits 0 and prints "idempotent"', () => {
  const { dir, manifestPath } = copyManifestToTmp();
  try {
    const r = run(['minimal', '--to', 'draft', '--manifest', manifestPath]);
    assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}; stderr: ${r.stderr}`);
    assert.ok(r.stdout.includes('idempotent'),
      `stdout should mention "idempotent": ${r.stdout}`);
  } finally {
    cleanup(dir);
  }
});

test('writes manifest on real promotion (draft -> candidate)', () => {
  const { dir, manifestPath } = copyManifestToTmp();
  try {
    const r = run(['minimal', '--to', 'candidate', '--manifest', manifestPath]);
    assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}; stderr: ${r.stderr}`);
    const onDisk = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.strictEqual(onDisk.profiles.minimal.settings.lifecycle, 'candidate');
  } finally {
    cleanup(dir);
  }
});

test('missing --to argument exits 2', () => {
  const { dir, manifestPath } = copyManifestToTmp();
  try {
    const r = run(['minimal', '--manifest', manifestPath]);
    assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
  } finally {
    cleanup(dir);
  }
});

test('parseArgs is exported and parses correctly', () => {
  const { parseArgs } = require('../../scripts/ecc-promote');
  const parsed = parseArgs(['node', 'ecc-promote.js', 'minimal', '--to', 'candidate', '--dry-run']);
  assert.strictEqual(parsed.help, false);
  assert.strictEqual(parsed.profileId, 'minimal');
  assert.strictEqual(parsed.toState, 'candidate');
  assert.strictEqual(parsed.dryRun, true);
  assert.strictEqual(parsed.force, false);
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
