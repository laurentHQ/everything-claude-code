/**
 * Integration tests for path-safety core (Track 3a).
 *
 * Covers the pure helpers in scripts/lib/install/path-safety.js plus the
 * apply-time assertion wired into scripts/lib/install/apply.js.
 *
 * Run with: node tests/integration/path-safety.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');

const {
  assertInsideAllowedRoot,
  isInsideAllowedRoot,
  resolveRealPath,
} = require(path.join(REPO_ROOT, 'scripts', 'lib', 'install', 'path-safety'));

const { applyInstallPlan } = require(path.join(REPO_ROOT, 'scripts', 'lib', 'install', 'apply'));

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ok ${name}`);
    passed += 1;
  } catch (err) {
    console.log(`  not ok ${name}`);
    console.log(`    ${err && err.stack ? err.stack.split('\n').slice(0, 4).join('\n    ') : err}`);
    failed += 1;
  }
}

function mkTmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-path-safety-'));
  // Resolve realpath so macOS /var → /private/var symlinks don't confuse
  // canonical-path comparisons inside the tests themselves.
  return fs.realpathSync(dir);
}

function rmTmp(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_err) {
    // best-effort
  }
}

console.log('\n=== Path-Safety Core Tests ===\n');

console.log('Pure helpers:');

test('traversal `..` escape rejected', () => {
  const tmp = mkTmp();
  try {
    const root = path.join(tmp, 'foo');
    fs.mkdirSync(root, { recursive: true });
    const evil = path.join(root, '..', '..', 'etc', 'passwd');
    assert.throws(
      () => assertInsideAllowedRoot(evil, [root]),
      /outside-allowed-root/
    );
  } finally {
    rmTmp(tmp);
  }
});

test('absolute path outside roots rejected', () => {
  const tmp = mkTmp();
  try {
    const root = path.join(tmp, 'foo');
    fs.mkdirSync(root, { recursive: true });
    assert.throws(
      () => assertInsideAllowedRoot('/etc/passwd', [root]),
      /outside-allowed-root/
    );
  } finally {
    rmTmp(tmp);
  }
});

test('symlink escape rejected via canonical resolution', () => {
  const tmp = mkTmp();
  try {
    const insideRoot = path.join(tmp, 'inside-root');
    const outsideRoot = path.join(tmp, 'outside-root');
    fs.mkdirSync(insideRoot, { recursive: true });
    fs.mkdirSync(outsideRoot, { recursive: true });

    const target = path.join(outsideRoot, 'target.txt');
    fs.writeFileSync(target, 'secret');

    const linkPath = path.join(insideRoot, 'leaky');
    fs.symlinkSync(target, linkPath);

    assert.throws(
      () => assertInsideAllowedRoot(linkPath, [insideRoot]),
      /outside-allowed-root/
    );
  } finally {
    rmTmp(tmp);
  }
});

test('empty allowedRoots is a no-op (array)', () => {
  assert.doesNotThrow(() => assertInsideAllowedRoot('/anywhere/x', []));
  assert.strictEqual(isInsideAllowedRoot('/anywhere/x', []), true);
});

test('empty allowedRoots is a no-op (null/undefined)', () => {
  assert.doesNotThrow(() => assertInsideAllowedRoot('/anywhere/x', null));
  assert.doesNotThrow(() => assertInsideAllowedRoot('/anywhere/x', undefined));
  assert.strictEqual(isInsideAllowedRoot('/anywhere/x', null), true);
});

test('nested path inside root passes', () => {
  const tmp = mkTmp();
  try {
    const root = path.join(tmp, 'foo');
    fs.mkdirSync(root, { recursive: true });
    const nested = path.join(root, 'bar', 'baz.txt');
    assert.doesNotThrow(() => assertInsideAllowedRoot(nested, [root]));
    assert.strictEqual(isInsideAllowedRoot(nested, [root]), true);
  } finally {
    rmTmp(tmp);
  }
});

test('destination equal to root passes', () => {
  const tmp = mkTmp();
  try {
    const root = path.join(tmp, 'foo');
    fs.mkdirSync(root, { recursive: true });
    assert.doesNotThrow(() => assertInsideAllowedRoot(root, [root]));
    assert.strictEqual(isInsideAllowedRoot(root, [root]), true);
  } finally {
    rmTmp(tmp);
  }
});

test('missing-intermediate-directory destination passes when inside root', () => {
  const tmp = mkTmp();
  try {
    const root = path.join(tmp, 'inside-root');
    fs.mkdirSync(root, { recursive: true });
    const futureDest = path.join(root, 'does', 'not', 'exist', 'yet.txt');
    assert.ok(!fs.existsSync(futureDest), 'future destination should not exist yet');
    assert.doesNotThrow(() => assertInsideAllowedRoot(futureDest, [root]));
  } finally {
    rmTmp(tmp);
  }
});

test('resolveRealPath returns canonical absolute path for missing destinations', () => {
  const tmp = mkTmp();
  try {
    const futureDest = path.join(tmp, 'does', 'not', 'exist', 'yet.txt');
    const resolved = resolveRealPath(futureDest);
    assert.ok(path.isAbsolute(resolved), 'should be absolute');
    assert.ok(resolved.startsWith(tmp), `resolved (${resolved}) should start with tmp (${tmp})`);
  } finally {
    rmTmp(tmp);
  }
});

test('error message contains exact contract substring', () => {
  let caught;
  try {
    assertInsideAllowedRoot('/etc/passwd', ['/tmp/somewhere-else-totally']);
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, 'should have thrown');
  assert.ok(
    caught.message.includes('reason: outside-allowed-root'),
    `message must contain contract substring, got: ${caught.message}`
  );
  assert.ok(
    caught.message.includes('Destination escapes allowed roots'),
    `message should start with the canonical prefix, got: ${caught.message}`
  );
});

console.log('\nIntegration with applyInstallPlan:');

test('applyInstallPlan throws when an operation escapes allowedRoots', () => {
  const tmp = mkTmp();
  try {
    const srcA = path.join(tmp, 'source-a.txt');
    const srcB = path.join(tmp, 'source-b.txt');
    fs.writeFileSync(srcA, 'A');
    fs.writeFileSync(srcB, 'B');

    const destA = path.join(tmp, 'dest-a.txt');
    const escapeDir = path.join(tmp, 'escape');
    fs.mkdirSync(escapeDir, { recursive: true });
    const destB = path.join(escapeDir, 'dest-b.txt');

    const plan = {
      adapter: { allowedRoots: () => [path.join(tmp, 'allowed')] },
      operations: [
        { kind: 'copy-file', moduleId: 'mod', sourcePath: srcA, destinationPath: destA },
        { kind: 'copy-file', moduleId: 'mod', sourcePath: srcB, destinationPath: destB },
      ],
      installStatePath: path.join(tmp, 'state.json'),
      statePreview: { schemaVersion: 'ecc.install.v1' },
      targetRoot: tmp,
    };

    let caught;
    try {
      applyInstallPlan(plan);
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, 'applyInstallPlan should throw');
    assert.ok(
      caught.message.includes('outside-allowed-root'),
      `should fail with outside-allowed-root, got: ${caught.message}`
    );

    // First op (destA) should also have been rejected because it is outside
    // the declared allowed root (path.join(tmp, 'allowed')) — verify the
    // assertion fires BEFORE any write happens.
    assert.ok(!fs.existsSync(destA), 'dest-a.txt must not be written when assertion fires first');
    assert.ok(!fs.existsSync(destB), 'dest-b.txt must not be written');
    assert.ok(!fs.existsSync(plan.installStatePath), 'state file must not be written');
  } finally {
    rmTmp(tmp);
  }
});

test('applyInstallPlan partial-write ordering when first op inside, second op outside', () => {
  const tmp = mkTmp();
  try {
    const allowed = path.join(tmp, 'allowed');
    const escape = path.join(tmp, 'escape');
    fs.mkdirSync(allowed, { recursive: true });
    fs.mkdirSync(escape, { recursive: true });

    const srcA = path.join(tmp, 'source-a.txt');
    const srcB = path.join(tmp, 'source-b.txt');
    fs.writeFileSync(srcA, 'A');
    fs.writeFileSync(srcB, 'B');

    const destA = path.join(allowed, 'a.txt');
    const destB = path.join(escape, 'b.txt');

    const plan = {
      adapter: { allowedRoots: () => [allowed] },
      operations: [
        { kind: 'copy-file', moduleId: 'mod', sourcePath: srcA, destinationPath: destA },
        { kind: 'copy-file', moduleId: 'mod', sourcePath: srcB, destinationPath: destB },
      ],
      installStatePath: path.join(allowed, 'state.json'),
      statePreview: { schemaVersion: 'ecc.install.v1' },
      targetRoot: allowed,
    };

    let caught;
    try {
      applyInstallPlan(plan);
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, 'applyInstallPlan should throw on second op');
    assert.ok(
      caught.message.includes('outside-allowed-root'),
      `expected outside-allowed-root, got: ${caught.message}`
    );

    assert.ok(fs.existsSync(destA), 'first operation (inside allowed) should have been written');
    assert.ok(!fs.existsSync(destB), 'second operation (escape) must not be written');
    // installState is written only after the loop completes, so the throw
    // mid-loop must prevent it.
    assert.ok(!fs.existsSync(plan.installStatePath), 'state file must not be written on partial failure');
  } finally {
    rmTmp(tmp);
  }
});

test('applyInstallPlan is a no-op when adapter declares no allowedRoots', () => {
  const tmp = mkTmp();
  try {
    const srcA = path.join(tmp, 'source-a.txt');
    fs.writeFileSync(srcA, 'A');
    const destA = path.join(tmp, 'wherever', 'a.txt');

    // Adapter has NO allowedRoots function — opt-in default kicks in.
    const plan = {
      adapter: {},
      operations: [
        { kind: 'copy-file', moduleId: 'mod', sourcePath: srcA, destinationPath: destA },
      ],
      installStatePath: path.join(tmp, 'state.json'),
      // Minimal valid install-state v1 with all required fields.
      statePreview: {
        schemaVersion: 'ecc.install.v1',
        installedAt: new Date().toISOString(),
        target: {
          id: 'test',
          target: 'test',
          kind: 'home',
          root: tmp,
          installStatePath: path.join(tmp, 'state.json'),
        },
        request: { profile: 'test', selectedModules: [] },
        resolution: { modules: [] },
        source: { repoRoot: tmp },
        operations: [],
      },
      targetRoot: tmp,
    };

    let caught;
    try {
      applyInstallPlan(plan);
    } catch (err) {
      caught = err;
    }

    // It might still throw for non-path-safety reasons (e.g., schema), but it
    // must NOT throw with the path-safety reason.
    if (caught) {
      assert.ok(
        !caught.message.includes('outside-allowed-root'),
        `should not throw outside-allowed-root for opt-out adapter, got: ${caught.message}`
      );
    }
    // The copy itself should have succeeded regardless of state-write outcome.
    assert.ok(fs.existsSync(destA), 'copy should succeed when adapter declares no allowedRoots');
  } finally {
    rmTmp(tmp);
  }
});

console.log('\n=== Test Results ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total:  ${passed + failed}\n`);

process.exit(failed > 0 ? 1 : 0);
