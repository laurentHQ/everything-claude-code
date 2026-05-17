/**
 * Tests for scripts/lib/install/audit-log.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  resolveAuditLogPath,
  appendAuditEvent,
  maybeAppendAuditEvent,
} = require('../../scripts/lib/install/audit-log');

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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'audit-log-test-'));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function runTests() {
  console.log('\n=== Testing install/audit-log.js ===\n');

  let passed = 0;
  let failed = 0;

  if (test('resolveAuditLogPath sandbox scope uses stateDir', () => {
    const resolved = resolveAuditLogPath({ scope: 'sandbox', stateDir: '/x' });
    assert.strictEqual(resolved, path.join('/x', 'audit.jsonl'));
  })) passed++; else failed++;

  if (test('resolveAuditLogPath project scope uses targetRoot/ecc', () => {
    const resolved = resolveAuditLogPath({ scope: 'project', targetRoot: '/r' });
    assert.strictEqual(resolved, path.join('/r', 'ecc', 'audit.jsonl'));
  })) passed++; else failed++;

  if (test('resolveAuditLogPath user scope uses targetRoot/ecc', () => {
    const resolved = resolveAuditLogPath({ scope: 'user', targetRoot: '/r' });
    assert.strictEqual(resolved, path.join('/r', 'ecc', 'audit.jsonl'));
  })) passed++; else failed++;

  if (test('resolveAuditLogPath honors overridePath verbatim', () => {
    const resolved = resolveAuditLogPath({ overridePath: '/anywhere/log.jsonl' });
    assert.strictEqual(resolved, '/anywhere/log.jsonl');
  })) passed++; else failed++;

  if (test('resolveAuditLogPath throws when nothing provided', () => {
    assert.throws(() => resolveAuditLogPath({}), /Cannot resolve audit-log path/);
  })) passed++; else failed++;

  if (test('appendAuditEvent writes one JSON line with trailing newline', () => {
    const dir = createTempDir();
    try {
      const filePath = path.join(dir, 'a.jsonl');
      appendAuditEvent(filePath, { kind: 'x', profileId: 'minimal' });
      const content = fs.readFileSync(filePath, 'utf8');
      assert.ok(content.endsWith('\n'), 'must end with newline');
      const lines = content.split('\n').filter(Boolean);
      assert.strictEqual(lines.length, 1);
      const parsed = JSON.parse(lines[0]);
      assert.strictEqual(parsed.kind, 'x');
      assert.strictEqual(parsed.profileId, 'minimal');
      assert.ok(typeof parsed.timestamp === 'string' && parsed.timestamp.length > 0);
    } finally {
      cleanup(dir);
    }
  })) passed++; else failed++;

  if (test('appendAuditEvent appends a second line on second call', () => {
    const dir = createTempDir();
    try {
      const filePath = path.join(dir, 'a.jsonl');
      appendAuditEvent(filePath, { kind: 'x' });
      appendAuditEvent(filePath, { kind: 'y' });
      const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
      assert.strictEqual(lines.length, 2);
      assert.strictEqual(JSON.parse(lines[0]).kind, 'x');
      assert.strictEqual(JSON.parse(lines[1]).kind, 'y');
    } finally {
      cleanup(dir);
    }
  })) passed++; else failed++;

  if (test('maybeAppendAuditEvent with null settings is a no-op', () => {
    const dir = createTempDir();
    try {
      const filePath = path.join(dir, 'a.jsonl');
      const result = maybeAppendAuditEvent({
        settings: null,
        targetRoot: dir,
        overridePath: filePath,
        event: { action: 'install-apply' },
      });
      assert.strictEqual(result, null);
      assert.ok(!fs.existsSync(filePath));
    } finally {
      cleanup(dir);
    }
  })) passed++; else failed++;

  if (test('maybeAppendAuditEvent with require_audit_log:true writes a line', () => {
    const dir = createTempDir();
    try {
      const filePath = path.join(dir, 'a.jsonl');
      const result = maybeAppendAuditEvent({
        settings: { require_audit_log: true },
        targetRoot: dir,
        overridePath: filePath,
        event: { action: 'install-apply' },
      });
      assert.strictEqual(result, filePath);
      const content = fs.readFileSync(filePath, 'utf8');
      assert.ok(content.includes('"action":"install-apply"'));
    } finally {
      cleanup(dir);
    }
  })) passed++; else failed++;

  if (test('maybeAppendAuditEvent with require_audit_log:false is a no-op', () => {
    const dir = createTempDir();
    try {
      const filePath = path.join(dir, 'a.jsonl');
      const result = maybeAppendAuditEvent({
        settings: { require_audit_log: false },
        targetRoot: dir,
        overridePath: filePath,
        event: { action: 'install-apply' },
      });
      assert.strictEqual(result, null);
      assert.ok(!fs.existsSync(filePath));
    } finally {
      cleanup(dir);
    }
  })) passed++; else failed++;

  if (test('maybeAppendAuditEvent with allowedRoots accepts path inside root', () => {
    const dir = createTempDir();
    try {
      const result = maybeAppendAuditEvent({
        settings: { require_audit_log: true },
        targetRoot: dir,
        allowedRoots: [dir],
        event: { action: 'install-apply' },
      });
      assert.strictEqual(result, path.join(dir, 'ecc', 'audit.jsonl'));
      assert.ok(fs.existsSync(result));
    } finally {
      cleanup(dir);
    }
  })) passed++; else failed++;

  if (test('maybeAppendAuditEvent with allowedRoots rejects override outside roots', () => {
    const dir = createTempDir();
    try {
      const outside = path.join(os.tmpdir(), 'audit-escape', 'log.jsonl');
      assert.throws(
        () => maybeAppendAuditEvent({
          settings: { require_audit_log: true },
          targetRoot: dir,
          allowedRoots: [dir],
          overridePath: outside,
          event: { action: 'install-apply' },
        }),
        /outside-allowed-root/,
        'expected the safety contract substring in the thrown message'
      );
      assert.ok(!fs.existsSync(outside), 'no file should have been created when assertion fails');
    } finally {
      cleanup(dir);
    }
  })) passed++; else failed++;

  if (test('maybeAppendAuditEvent with empty allowedRoots skips the check (opt-in)', () => {
    const dir = createTempDir();
    try {
      const filePath = path.join(dir, 'plain.jsonl');
      const result = maybeAppendAuditEvent({
        settings: { require_audit_log: true },
        targetRoot: dir,
        allowedRoots: [],
        overridePath: filePath,
        event: { action: 'install-apply' },
      });
      assert.strictEqual(result, filePath);
      assert.ok(fs.existsSync(filePath));
    } finally {
      cleanup(dir);
    }
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
