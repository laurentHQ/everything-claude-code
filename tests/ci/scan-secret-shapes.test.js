/**
 * Tests for scripts/ci/scan-secret-shapes.js (T6).
 *
 * Builds fixture trees in a temp dir and invokes runScan({ roots, repoRoot })
 * directly. Verifies positive matches for each pattern and the
 * placeholder-context allowlist.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runScan } = require('../../scripts/ci/scan-secret-shapes');

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

function makeTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeFixture(repoRoot, relName, contents) {
  // Create a single-file fixture under repoRoot/fixtures/<relName>
  const dir = path.join(repoRoot, 'fixtures');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, relName), contents);
}

function scanFixtures(repoRoot) {
  return runScan({ roots: ['fixtures'], repoRoot });
}

function runTests() {
  console.log('\n=== scan-secret-shapes tests (T6) ===\n');

  let passed = 0;
  let failed = 0;

  if (test('negative (clean): env placeholder ${GITHUB_TOKEN} → 0 findings', () => {
    const repo = makeTmp('scan-clean-');
    try {
      writeFixture(repo, 'config.yml', 'token: ${GITHUB_TOKEN}\nother: nothing here\n');
      const findings = scanFixtures(repo);
      assert.strictEqual(findings.length, 0, `expected 0 findings, got ${findings.length}`);
    } finally { cleanup(repo); }
  })) passed++; else failed++;

  if (test('positive (github): ghp_ token → 1 finding of github-token', () => {
    const repo = makeTmp('scan-gh-');
    try {
      writeFixture(repo, 'leak.txt', 'token=ghp_' + 'X'.repeat(30) + '\n');
      const findings = scanFixtures(repo);
      assert.strictEqual(findings.length, 1);
      assert.strictEqual(findings[0].pattern, 'github-token');
    } finally { cleanup(repo); }
  })) passed++; else failed++;

  if (test('positive (openai): sk- key → 1 finding of openai-key', () => {
    const repo = makeTmp('scan-openai-');
    try {
      writeFixture(repo, 'leak.txt', 'OPENAI=sk-' + 'A'.repeat(40) + '\n');
      const findings = scanFixtures(repo);
      assert.strictEqual(findings.length, 1);
      assert.strictEqual(findings[0].pattern, 'openai-key');
    } finally { cleanup(repo); }
  })) passed++; else failed++;

  if (test('positive (anthropic): sk-ant- key → 1 finding of anthropic-key', () => {
    const repo = makeTmp('scan-anth-');
    try {
      // sk-ant- prefix + 60 hex-ish chars (matches [A-Za-z0-9-]{50,})
      writeFixture(repo, 'leak.txt', 'ANT=sk-ant-' + 'a'.repeat(60) + '\n');
      const findings = scanFixtures(repo);
      // anthropic pattern matches; the openai pattern (\bsk-...) ALSO matches
      // since sk-ant- starts with sk-. The scanner records both; that's fine
      // — at least one is anthropic-key.
      assert.ok(findings.length >= 1, `expected >=1 finding, got ${findings.length}`);
      assert.ok(
        findings.some(f => f.pattern === 'anthropic-key'),
        `expected anthropic-key finding, got ${JSON.stringify(findings.map(f => f.pattern))}`
      );
    } finally { cleanup(repo); }
  })) passed++; else failed++;

  if (test('positive (aws): AKIA example → 1 finding of aws-access-key', () => {
    const repo = makeTmp('scan-aws-');
    try {
      writeFixture(repo, 'leak.txt', 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\n');
      const findings = scanFixtures(repo);
      assert.strictEqual(findings.length, 1);
      assert.strictEqual(findings[0].pattern, 'aws-access-key');
    } finally { cleanup(repo); }
  })) passed++; else failed++;

  if (test('placeholder + real-shape on same line → 0 findings (allowlisted)', () => {
    const repo = makeTmp('scan-mixed-');
    try {
      writeFixture(
        repo,
        'leak.txt',
        'gh ghp_' + 'X'.repeat(25) + ' inside ${SECRET}\n'
      );
      const findings = scanFixtures(repo);
      assert.strictEqual(findings.length, 0, `expected 0 findings (placeholder allowlist), got ${findings.length}`);
    } finally { cleanup(repo); }
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
