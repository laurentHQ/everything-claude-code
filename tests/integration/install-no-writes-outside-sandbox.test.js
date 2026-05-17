/**
 * Safety harness: running an install with a tmpdir homeDir/projectRoot
 * must not write any file outside that tmpdir.
 *
 * Approach: enumerate the repo-root file tree before/after, plus the
 * tmpdir file tree before/after. The repo-root delta must be empty.
 * Only the tmpdir delta may be non-empty.
 */

'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  applyInstallPlan,
  createManifestInstallPlan,
} = require('../../scripts/lib/install-executor');
const { getInstallTargetAdapter } = require('../../scripts/lib/install-targets/registry');

const REPO_ROOT = path.join(__dirname, '../..');

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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'install-no-writes-outside-'));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// Build a Map<relativePath, sha256> for every file under dir.
// Skip directories that explode the cost (node_modules, .git) — those would
// be unaffected by an install anyway, and scanning them is prohibitively slow.
const SKIP_DIRS = new Set(['node_modules', '.git', '.sandbox', 'tests']);

function snapshotTree(root) {
  const snapshot = new Map();
  if (!fs.existsSync(root)) return snapshot;
  function walk(current, relPrefix) {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (relPrefix === '' && SKIP_DIRS.has(entry.name)) continue;
        walk(path.join(current, entry.name), path.join(relPrefix, entry.name));
      } else if (entry.isFile()) {
        const rel = path.join(relPrefix, entry.name);
        const full = path.join(current, entry.name);
        try {
          const data = fs.readFileSync(full);
          snapshot.set(rel, crypto.createHash('sha256').update(data).digest('hex'));
        } catch {
          // Skip files we cannot read.
        }
      }
    }
  }
  walk(root, '');
  return snapshot;
}

function diffSnapshots(before, after) {
  const added = [];
  const removed = [];
  const modified = [];
  for (const [key, hash] of after) {
    if (!before.has(key)) {
      added.push(key);
    } else if (before.get(key) !== hash) {
      modified.push(key);
    }
  }
  for (const key of before.keys()) {
    if (!after.has(key)) removed.push(key);
  }
  return { added, removed, modified };
}

function runTests() {
  console.log('\n=== Testing install writes stay inside tmpdir ===\n');

  let passed = 0;
  let failed = 0;

  if (test('install of minimal x claude does not write outside tmpdir', () => {
    const tmp = createTempDir();

    // Snapshot REPO_ROOT (excluding node_modules/.git/tests/.sandbox) before.
    const repoBefore = snapshotTree(REPO_ROOT);
    const tmpBefore = snapshotTree(tmp);

    try {
      const plan = createManifestInstallPlan({
        profileId: 'minimal',
        target: 'claude',
        homeDir: tmp,
        projectRoot: tmp,
      });
      const adapter = getInstallTargetAdapter('claude');
      const applyPlan = {
        ...plan,
        adapter,
        homeDir: tmp,
        projectRoot: tmp,
      };
      applyInstallPlan(applyPlan);

      const tmpAfter = snapshotTree(tmp);
      const repoAfter = snapshotTree(REPO_ROOT);

      const tmpDelta = diffSnapshots(tmpBefore, tmpAfter);
      const repoDelta = diffSnapshots(repoBefore, repoAfter);

      // tmpdir SHOULD have added files (install wrote there).
      assert.ok(
        tmpDelta.added.length > 0,
        'expected install to write files into tmpdir'
      );

      // Repo MUST be unchanged.
      assert.deepStrictEqual(
        repoDelta.added,
        [],
        `unexpected files added under repo root: ${repoDelta.added.join(', ')}`
      );
      assert.deepStrictEqual(
        repoDelta.modified,
        [],
        `unexpected files modified under repo root: ${repoDelta.modified.join(', ')}`
      );
      assert.deepStrictEqual(
        repoDelta.removed,
        [],
        `unexpected files removed under repo root: ${repoDelta.removed.join(', ')}`
      );
    } finally {
      cleanup(tmp);
    }
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
