/**
 * Tests for install-lifecycle handling of `copy-path` operations.
 * `copy-path` is an alias for `copy-file` and must round-trip through
 * uninstall + repair.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { writeInstallState } = require('../../scripts/lib/install-state');
const {
  uninstallInstalledStates,
  repairInstalledStates,
} = require('../../scripts/lib/install-lifecycle');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-copy-path-'));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function buildState({ repoRoot, homeDir, sourceRelativePath, destinationPath }) {
  const claudeRoot = path.join(homeDir, '.claude');
  const statePath = path.join(claudeRoot, 'ecc', 'install-state.json');
  return {
    statePath,
    state: {
      schemaVersion: 'ecc.install.v2',
      installedAt: '2026-05-17T00:00:00Z',
      target: {
        id: 'claude-home',
        target: 'claude',
        kind: 'home',
        root: claudeRoot,
        installStatePath: statePath,
      },
      request: {
        profile: null,
        modules: ['mod-a'],
        includeComponents: [],
        excludeComponents: [],
        legacyLanguages: [],
        legacyMode: false,
      },
      resolution: {
        selectedModules: ['mod-a'],
        skippedModules: [],
      },
      source: {
        repoVersion: '0.0.0-test',
        repoCommit: null,
        manifestVersion: 1,
      },
      operations: [
        {
          kind: 'copy-path',
          moduleId: 'mod-a',
          sourceRelativePath,
          destinationPath,
          strategy: 'preserve-relative-path',
          ownership: 'managed',
          scaffoldOnly: false,
        },
        // Add a non-copy-file op so repair takes the "recorded" branch and
        // doesn't try to re-resolve manifests from the temp repoRoot.
        {
          kind: 'merge-json',
          moduleId: 'mod-a',
          sourceRelativePath: 'no-op.json',
          destinationPath: path.join(claudeRoot, 'no-op.json'),
          strategy: 'merge-json',
          ownership: 'managed',
          scaffoldOnly: false,
          mergePayload: { _noop: true },
        },
      ],
    },
  };
}

function runTests() {
  console.log('\n=== Testing install-lifecycle copy-path round-trip ===\n');

  let passed = 0;
  let failed = 0;

  if (test('uninstall handles copy-path operation without throwing', () => {
    const repoRoot = createTempDir();
    const homeDir = createTempDir();
    try {
      const sourceRelativePath = 'agents/my-agent.md';
      const sourcePath = path.join(repoRoot, sourceRelativePath);
      fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
      fs.writeFileSync(sourcePath, 'hello');

      const destinationPath = path.join(homeDir, '.claude', 'agents', 'my-agent.md');
      fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
      fs.copyFileSync(sourcePath, destinationPath);

      const { statePath, state } = buildState({
        repoRoot,
        homeDir,
        sourceRelativePath,
        destinationPath,
      });
      writeInstallState(statePath, state);

      const report = uninstallInstalledStates({
        homeDir,
        projectRoot: repoRoot,
        targets: ['claude'],
      });

      const result = report.results.find(r => r.adapter.target === 'claude');
      assert.ok(result, 'expected a claude uninstall result');
      assert.strictEqual(result.status, 'uninstalled', `error: ${result.error}`);
      assert.ok(result.removedPaths.includes(destinationPath));
      assert.ok(!fs.existsSync(destinationPath), 'destination should be removed');
      assert.ok(!fs.existsSync(statePath), 'install-state should be removed');
    } finally {
      cleanup(repoRoot);
      cleanup(homeDir);
    }
  })) passed++; else failed++;

  if (test('repair handles a drifted copy-path destination without throwing', () => {
    const homeDir = createTempDir();
    try {
      // Use a real source file from the repo so repair's missing-source check
      // is satisfied. The presence of a merge-json op in the state forces
      // repair into the "recorded" branch, which is what we want to exercise.
      const sourceRelativePath = 'agents/architect.md';
      const sourcePath = path.join(REPO_ROOT, sourceRelativePath);
      assert.ok(fs.existsSync(sourcePath), 'precondition: repo file must exist');

      const destinationPath = path.join(homeDir, '.claude', 'agents', 'architect.md');
      fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
      fs.writeFileSync(destinationPath, 'drifted');

      const { statePath, state } = buildState({
        repoRoot: REPO_ROOT,
        homeDir,
        sourceRelativePath,
        destinationPath,
      });
      writeInstallState(statePath, state);

      const report = repairInstalledStates({
        repoRoot: REPO_ROOT,
        homeDir,
        projectRoot: homeDir,
        targets: ['claude'],
      });

      const result = report.results.find(r => r.adapter.target === 'claude');
      assert.ok(result, 'expected a claude repair result');
      // The critical check is that the call did not throw and copy-path was
      // recognised (no "Unsupported repair operation kind" error).
      assert.notStrictEqual(result.status, 'error', `repair errored: ${result.error}`);
      // After repair the destination should match the pristine source.
      const repaired = fs.readFileSync(destinationPath, 'utf8');
      const expected = fs.readFileSync(sourcePath, 'utf8');
      assert.strictEqual(repaired, expected, 'destination should be restored to source content');
    } finally {
      cleanup(homeDir);
    }
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
