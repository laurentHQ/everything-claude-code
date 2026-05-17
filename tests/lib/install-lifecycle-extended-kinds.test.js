/**
 * V1 Wave 1 / T2-rest: end-to-end lifecycle tests for the extended
 * operation kinds added in this wave (copy-tree, flatten-copy,
 * render-template, merge-jsonc, mkdir, remove).
 *
 * Each test builds a small in-process plan, calls applyInstallPlan, then
 * calls uninstallInstalledStates and asserts the destination state.
 *
 * The plans are constructed in the same shape as Wave 0
 * tests/integration/apply-unknown-kind.test.js: a hand-crafted plan object
 * passed directly to applyInstallPlan. The statePreview is hand-built to
 * pass install-state.schema.json validation.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const { applyInstallPlan } = require(path.join(REPO_ROOT, 'scripts', 'lib', 'install', 'apply'));
const {
  uninstallInstalledStates,
} = require(path.join(REPO_ROOT, 'scripts', 'lib', 'install-lifecycle'));

const CURRENT_PACKAGE_VERSION = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')
).version;
const CURRENT_MANIFEST_VERSION = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'manifests', 'install-modules.json'), 'utf8')
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

function mkTmp(label) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `lifecycle-ext-${label}-`)));
}

function rmTmp(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_e) { /* best-effort */ }
}

function buildOperation(kind, overrides = {}) {
  return {
    kind,
    moduleId: 'ext-test',
    sourceRelativePath: overrides.sourceRelativePath || `fixtures/${kind}.txt`,
    destinationPath: overrides.destinationPath,
    strategy: overrides.strategy || kind,
    ownership: 'managed',
    scaffoldOnly: false,
    ...overrides,
  };
}

function buildPlan({ projectRoot, operations }) {
  const targetRoot = path.join(projectRoot, '.cursor');
  fs.mkdirSync(targetRoot, { recursive: true });
  const installStatePath = path.join(targetRoot, 'ecc-install-state.json');
  const adapter = {
    id: 'cursor-project',
    target: 'cursor',
    kind: 'project',
    // V1 Wave 1: keep allowedRoots permissive so the only thing under test
    // is the operation-kind dispatch + lifecycle round-trip.
    allowedRoots: () => [projectRoot],
  };
  const statePreview = {
    schemaVersion: 'ecc.install.v2',
    installedAt: new Date().toISOString(),
    target: {
      id: adapter.id,
      target: adapter.target,
      kind: adapter.kind,
      root: targetRoot,
      installStatePath,
    },
    request: {
      profile: null,
      modules: [],
      includeComponents: [],
      excludeComponents: [],
      legacyLanguages: [],
      legacyMode: false,
    },
    resolution: {
      selectedModules: ['ext-test'],
      skippedModules: [],
    },
    operations: operations.map(op => ({
      kind: op.kind,
      moduleId: op.moduleId,
      sourceRelativePath: op.sourceRelativePath,
      destinationPath: op.destinationPath,
      strategy: op.strategy,
      ownership: op.ownership,
      scaffoldOnly: op.scaffoldOnly,
    })),
    source: {
      repoVersion: CURRENT_PACKAGE_VERSION,
      repoCommit: null,
      manifestVersion: CURRENT_MANIFEST_VERSION,
    },
  };
  return {
    adapter,
    operations,
    installStatePath,
    statePreview,
    targetRoot,
    homeDir: os.homedir(),
    projectRoot,
    repoRoot: REPO_ROOT,
    scope: 'project',
  };
}

function runUninstall(projectRoot) {
  return uninstallInstalledStates({
    homeDir: os.homedir(),
    projectRoot,
    targets: ['cursor'],
  });
}

function runTests() {
  console.log('\n=== V1 Wave 1 / T2-rest: lifecycle round-trip for extended kinds ===\n');
  let passed = 0;
  let failed = 0;

  if (test('copy-tree: install copies, uninstall removes', () => {
    const projectRoot = mkTmp('copy-tree');
    try {
      const src = path.join(projectRoot, 'src.txt');
      const dest = path.join(projectRoot, '.cursor', 'tree', 'src.txt');
      fs.writeFileSync(src, 'tree-content');
      const op = buildOperation('copy-tree', {
        sourcePath: src,
        sourceRelativePath: 'src.txt',
        destinationPath: dest,
        strategy: 'preserve-relative-path',
      });
      const plan = buildPlan({ projectRoot, operations: [op] });
      applyInstallPlan(plan);
      assert.strictEqual(fs.readFileSync(dest, 'utf8'), 'tree-content');

      const result = runUninstall(projectRoot);
      assert.strictEqual(result.results[0].status, 'uninstalled');
      assert.ok(!fs.existsSync(dest), 'destination should be removed');
    } finally { rmTmp(projectRoot); }
  })) passed++; else failed++;

  if (test('flatten-copy: install copies, uninstall removes', () => {
    const projectRoot = mkTmp('flatten-copy');
    try {
      const src = path.join(projectRoot, 'rules', 'foo.md');
      fs.mkdirSync(path.dirname(src), { recursive: true });
      fs.writeFileSync(src, 'rule body');
      const dest = path.join(projectRoot, '.cursor', 'rules', 'foo.md');
      const op = buildOperation('flatten-copy', {
        sourcePath: src,
        sourceRelativePath: 'rules/foo.md',
        destinationPath: dest,
        strategy: 'flatten-copy',
      });
      const plan = buildPlan({ projectRoot, operations: [op] });
      applyInstallPlan(plan);
      assert.strictEqual(fs.readFileSync(dest, 'utf8'), 'rule body');

      const result = runUninstall(projectRoot);
      assert.strictEqual(result.results[0].status, 'uninstalled');
      assert.ok(!fs.existsSync(dest));
    } finally { rmTmp(projectRoot); }
  })) passed++; else failed++;

  if (test('merge-jsonc: install creates file, uninstall removes managed subset', () => {
    const projectRoot = mkTmp('merge-jsonc');
    try {
      const dest = path.join(projectRoot, '.cursor', 'settings.json');
      const payload = { ecc: { managed: true } };
      const op = buildOperation('merge-jsonc', {
        sourceRelativePath: '.cursor/settings.json',
        destinationPath: dest,
        strategy: 'merge-jsonc',
        mergePayload: payload,
      });
      const plan = buildPlan({ projectRoot, operations: [op] });
      // statePreview operations need mergePayload for uninstall.
      plan.statePreview.operations[0].mergePayload = payload;
      applyInstallPlan(plan);
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(dest, 'utf8')), { ecc: { managed: true } });

      const result = runUninstall(projectRoot);
      assert.strictEqual(result.results[0].status, 'uninstalled');
      // Subset removal: full file deleted because no other keys remain.
      assert.ok(!fs.existsSync(dest), 'destination should be removed once managed subset is fully removed');
    } finally { rmTmp(projectRoot); }
  })) passed++; else failed++;

  if (test('mkdir: install creates directory, uninstall removes if empty', () => {
    const projectRoot = mkTmp('mkdir');
    try {
      const dest = path.join(projectRoot, '.cursor', 'created-dir');
      const op = buildOperation('mkdir', {
        sourceRelativePath: 'ignored/mkdir-source',
        destinationPath: dest,
        strategy: 'mkdir',
      });
      const plan = buildPlan({ projectRoot, operations: [op] });
      applyInstallPlan(plan);
      assert.ok(fs.statSync(dest).isDirectory(), 'directory should be created');

      const result = runUninstall(projectRoot);
      assert.strictEqual(result.results[0].status, 'uninstalled');
      assert.ok(!fs.existsSync(dest), 'empty mkdir directory should be removed');
    } finally { rmTmp(projectRoot); }
  })) passed++; else failed++;

  if (test('remove: install removes pre-existing file, uninstall is no-op (no backup)', () => {
    const projectRoot = mkTmp('remove');
    try {
      const dest = path.join(projectRoot, '.cursor', 'doomed.txt');
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, 'will-be-deleted');
      const op = buildOperation('remove', {
        sourceRelativePath: 'ignored/remove-source',
        destinationPath: dest,
        strategy: 'remove',
      });
      const plan = buildPlan({ projectRoot, operations: [op] });
      applyInstallPlan(plan);
      assert.ok(!fs.existsSync(dest), 'install-time remove should delete the file');

      const result = runUninstall(projectRoot);
      assert.strictEqual(result.results[0].status, 'uninstalled');
      // No backup recorded → uninstall is a no-op for the destination.
      assert.ok(!fs.existsSync(dest));
    } finally { rmTmp(projectRoot); }
  })) passed++; else failed++;

  if (test('render-template: install renders template, uninstall removes file', () => {
    const projectRoot = mkTmp('render-template');
    try {
      const src = path.join(projectRoot, 'tpl.txt');
      fs.writeFileSync(src, 'Hi {{who}}!');
      const dest = path.join(projectRoot, '.cursor', 'greeting.txt');
      const op = buildOperation('render-template', {
        sourcePath: src,
        sourceRelativePath: 'tpl.txt',
        destinationPath: dest,
        strategy: 'render-template',
        context: { who: 'tester' },
      });
      const plan = buildPlan({ projectRoot, operations: [op] });
      applyInstallPlan(plan);
      assert.strictEqual(fs.readFileSync(dest, 'utf8'), 'Hi tester!');

      const result = runUninstall(projectRoot);
      assert.strictEqual(result.results[0].status, 'uninstalled');
      assert.ok(!fs.existsSync(dest), 'rendered file should be removed (no backup → file unlinked)');
    } finally { rmTmp(projectRoot); }
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
