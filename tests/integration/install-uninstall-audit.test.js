/**
 * Integration tests for the audit-log writer wired into install + uninstall.
 *
 * These exercise scripts/lib/install/apply.js and
 * scripts/lib/install-lifecycle.js to confirm:
 *   - audit.jsonl is written when settings.require_audit_log === true
 *   - audit.jsonl is NOT written when require_audit_log is false/missing
 *   - install + uninstall append one line each
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { applyInstallPlan } = require('../../scripts/lib/install/apply');
const { createInstallState } = require('../../scripts/lib/install-state');
const { uninstallInstalledStates } = require('../../scripts/lib/install-lifecycle');

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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'install-uninstall-audit-'));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function buildPlan({ tmpDir, requireAuditLog }) {
  const claudeRoot = path.join(tmpDir, '.claude');
  const installStatePath = path.join(claudeRoot, 'ecc', 'install-state.json');

  const sourcePath = path.join(tmpDir, 'source-agent.md');
  fs.writeFileSync(sourcePath, 'agent content\n');
  const destinationPath = path.join(claudeRoot, 'agents', 'agent.md');

  const settings = requireAuditLog !== undefined
    ? { require_audit_log: requireAuditLog }
    : undefined;

  const statePreview = createInstallState({
    adapter: { id: 'claude-home', target: 'claude', kind: 'home' },
    targetRoot: claudeRoot,
    installStatePath,
    request: {
      profile: 'security',
      modules: [],
      includeComponents: [],
      excludeComponents: [],
      legacyLanguages: [],
      legacyMode: false,
    },
    resolution: {
      selectedModules: ['mod-a'],
      skippedModules: [],
    },
    operations: [
      {
        kind: 'copy-file',
        moduleId: 'mod-a',
        sourcePath,
        sourceRelativePath: 'source-agent.md',
        destinationPath,
        strategy: 'preserve-relative-path',
        ownership: 'managed',
        scaffoldOnly: false,
      },
    ],
    source: {
      repoVersion: '0.0.0-test',
      repoCommit: null,
      manifestVersion: 1,
    },
    settings,
  });

  return {
    adapter: {
      target: 'claude',
      allowedRoots: () => [claudeRoot],
    },
    targetRoot: claudeRoot,
    installStatePath,
    operations: [
      {
        kind: 'copy-file',
        moduleId: 'mod-a',
        sourcePath,
        sourceRelativePath: 'source-agent.md',
        destinationPath,
        strategy: 'preserve-relative-path',
        ownership: 'managed',
        scaffoldOnly: false,
      },
    ],
    statePreview,
  };
}

function runTests() {
  console.log('\n=== Testing install/uninstall audit-log integration ===\n');

  let passed = 0;
  let failed = 0;

  if (test('install with require_audit_log:true writes an install-apply entry', () => {
    const tmp = createTempDir();
    try {
      const plan = buildPlan({ tmpDir: tmp, requireAuditLog: true });
      applyInstallPlan(plan);

      const auditPath = path.join(tmp, '.claude', 'ecc', 'audit.jsonl');
      assert.ok(fs.existsSync(auditPath), 'audit.jsonl should exist');
      const lines = fs.readFileSync(auditPath, 'utf8').split('\n').filter(Boolean);
      assert.strictEqual(lines.length, 1, 'one audit line expected');
      const event = JSON.parse(lines[0]);
      assert.strictEqual(event.action, 'install-apply');
      assert.strictEqual(event.profileId, 'security');
      assert.strictEqual(event.target, 'claude');
      assert.deepStrictEqual(event.modules, ['mod-a']);
      assert.strictEqual(event.operationCount, 1);
      assert.ok(typeof event.timestamp === 'string');
    } finally {
      cleanup(tmp);
    }
  })) passed++; else failed++;

  if (test('install with require_audit_log:false does not write audit.jsonl', () => {
    const tmp = createTempDir();
    try {
      const plan = buildPlan({ tmpDir: tmp, requireAuditLog: false });
      applyInstallPlan(plan);

      const auditPath = path.join(tmp, '.claude', 'ecc', 'audit.jsonl');
      assert.ok(!fs.existsSync(auditPath), 'audit.jsonl should NOT exist');
    } finally {
      cleanup(tmp);
    }
  })) passed++; else failed++;

  if (test('install with no settings does not write audit.jsonl', () => {
    const tmp = createTempDir();
    try {
      const plan = buildPlan({ tmpDir: tmp, requireAuditLog: undefined });
      applyInstallPlan(plan);

      const auditPath = path.join(tmp, '.claude', 'ecc', 'audit.jsonl');
      assert.ok(!fs.existsSync(auditPath), 'audit.jsonl should NOT exist');
    } finally {
      cleanup(tmp);
    }
  })) passed++; else failed++;

  if (test('install succeeds and stderr-warns when audit-log append fails (EISDIR)', () => {
    const tmp = createTempDir();
    const origWrite = process.stderr.write.bind(process.stderr);
    const captured = [];
    process.stderr.write = (chunk) => {
      captured.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
      return true;
    };
    try {
      // Pre-create the audit-log path AS A DIRECTORY so fs.appendFileSync
      // fails with EISDIR. The install must still succeed end-to-end.
      const auditPath = path.join(tmp, '.claude', 'ecc', 'audit.jsonl');
      fs.mkdirSync(path.dirname(auditPath), { recursive: true });
      fs.mkdirSync(auditPath);

      const plan = buildPlan({ tmpDir: tmp, requireAuditLog: true });
      const result = applyInstallPlan(plan);

      assert.strictEqual(result.applied, true, 'install must succeed even when audit-log write fails');
      assert.ok(fs.existsSync(plan.installStatePath), 'install-state must be written');
      assert.ok(fs.existsSync(plan.operations[0].destinationPath), 'operation destination must be written');
      const stderr = captured.join('');
      assert.ok(stderr.includes('[audit-log]'), `expected [audit-log] in stderr, got: ${stderr}`);
    } finally {
      process.stderr.write = origWrite;
      cleanup(tmp);
    }
  })) passed++; else failed++;

  if (test('install then uninstall both append entries when audit-log enabled', () => {
    const tmp = createTempDir();
    try {
      const plan = buildPlan({ tmpDir: tmp, requireAuditLog: true });
      applyInstallPlan(plan);

      const report = uninstallInstalledStates({
        homeDir: tmp,
        projectRoot: tmp,
        targets: ['claude'],
      });
      const result = report.results.find(r => r.adapter && r.adapter.target === 'claude');
      assert.ok(result, 'expected claude uninstall result');
      assert.strictEqual(result.status, 'uninstalled', `error: ${result.error}`);

      const auditPath = path.join(tmp, '.claude', 'ecc', 'audit.jsonl');
      assert.ok(fs.existsSync(auditPath));
      const lines = fs.readFileSync(auditPath, 'utf8').split('\n').filter(Boolean);
      assert.strictEqual(lines.length, 2, `expected 2 audit lines, got ${lines.length}`);
      const events = lines.map(line => JSON.parse(line));
      assert.strictEqual(events[0].action, 'install-apply');
      assert.strictEqual(events[1].action, 'uninstall');
      assert.strictEqual(events[1].profileId, 'security');
    } finally {
      cleanup(tmp);
    }
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
