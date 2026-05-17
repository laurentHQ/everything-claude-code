/**
 * Anti-rot guard for the T8 profile-safety docs.
 *
 * Asserts:
 *   1. Every CLI command in PROFILE-SAFETY-GUIDE.md uses real flags that
 *      exist in the underlying script source.
 *   2. Every "enforced" row in PROFILE-LIMITATIONS.md that names a
 *      conflict reason maps to a real enum value in
 *      schemas/install-plan.schema.json.
 *   3. Every "deferred to v1.1" row has a non-empty description and a
 *      Tracking column that points at either "v1.1 plan" or a file under
 *      .claude/plan/.
 *   4. Every reason in the PROFILE-SAFETY-GUIDE.md triage table is either
 *      in the enum or explicitly marked reserved.
 *   5. Neither doc carries `<filename>.<ext>:<lineno>` line-number rot.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../..');
const LIMITATIONS_PATH = path.join(REPO_ROOT, 'docs', 'PROFILE-LIMITATIONS.md');
const GUIDE_PATH = path.join(REPO_ROOT, 'docs', 'PROFILE-SAFETY-GUIDE.md');
const SCHEMA_PATH = path.join(REPO_ROOT, 'schemas', 'install-plan.schema.json');

function readFile(p) {
  return fs.readFileSync(p, 'utf8');
}

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

function getReasonEnum() {
  const schema = JSON.parse(readFile(SCHEMA_PATH));
  return schema.properties.conflicts.items.properties.reason.enum;
}

function extractCodeBlocks(markdown) {
  const blocks = [];
  const re = /```[a-zA-Z0-9_-]*\n([\s\S]*?)```/g;
  let match;
  while ((match = re.exec(markdown)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

function extractNodeInvocations(codeBlock) {
  const invocations = [];
  const lines = codeBlock.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('node scripts/')) continue;
    const tokens = trimmed.split(/\s+/);
    const scriptToken = tokens[1];
    const flags = tokens.filter(t => t.startsWith('--'));
    invocations.push({ script: scriptToken, flags });
  }
  return invocations;
}

function parseTablesInSection(markdown, sectionHeader) {
  const idx = markdown.indexOf(sectionHeader);
  if (idx === -1) return [];
  const rest = markdown.slice(idx + sectionHeader.length);
  const nextSection = rest.search(/\n## /);
  const sectionText = nextSection === -1 ? rest : rest.slice(0, nextSection);

  const tables = [];
  const lines = sectionText.split('\n');
  let current = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      if (/^\|[\s|:-]+\|$/.test(trimmed)) continue;
      if (!current) current = [];
      const cells = trimmed
        .slice(1, -1)
        .split('|')
        .map(c => c.trim());
      current.push(cells);
    } else if (current) {
      tables.push(current);
      current = null;
    }
  }
  if (current) tables.push(current);
  return tables;
}

function runTests() {
  console.log('=== docs/profile-safety walkthrough (T8) ===\n');

  const limitations = readFile(LIMITATIONS_PATH);
  const guide = readFile(GUIDE_PATH);
  const enumValues = getReasonEnum();

  let passed = 0;
  let failed = 0;

  if (test('Guide: every node-script invocation uses a flag that exists in the script source', () => {
    const blocks = extractCodeBlocks(guide);
    const invocations = blocks.flatMap(extractNodeInvocations);
    assert.ok(invocations.length > 0, 'expected at least one node script example in the guide');

    const scriptCache = new Map();
    function readScript(rel) {
      if (!scriptCache.has(rel)) {
        const full = path.join(REPO_ROOT, rel);
        scriptCache.set(rel, readFile(full));
      }
      return scriptCache.get(rel);
    }

    for (const invocation of invocations) {
      const src = readScript(invocation.script);
      for (const flag of invocation.flags) {
        assert.ok(
          src.includes(flag),
          `flag ${flag} (used with ${invocation.script}) does not appear in ${invocation.script}`
        );
      }
    }
  })) passed++; else failed++;

  if (test('Limitations: every "enforced" conflict reason maps to schema enum', () => {
    const tables = parseTablesInSection(limitations, '## What is enforced in v1');
    assert.ok(tables.length >= 1, 'expected at least one table in "What is enforced in v1"');
    const rows = tables[0].slice(1);

    const reasonRe = /`([a-z][a-z0-9-]+)`/g;
    let checkedAtLeastOne = false;
    for (const row of rows) {
      const lastCell = row[row.length - 1];
      if (!lastCell) continue;
      if (lastCell.toLowerCase().startsWith('n/a')) continue;
      const tokens = [];
      let m;
      while ((m = reasonRe.exec(lastCell)) !== null) tokens.push(m[1]);
      const candidates = tokens.filter(t => /^[a-z][a-z0-9-]+$/.test(t));
      for (const candidate of candidates) {
        if (['warning', 'error', 'project', 'sandbox', 'user'].includes(candidate)) continue;
        if (enumValues.includes(candidate)) {
          checkedAtLeastOne = true;
          continue;
        }
        if (candidate.includes('-')) {
          assert.fail(
            `enforced row references unknown conflict reason \`${candidate}\` - not in schema enum [${enumValues.join(', ')}]`
          );
        }
      }
    }
    assert.ok(checkedAtLeastOne, 'expected at least one enforced row to name a known conflict reason');
  })) passed++; else failed++;

  if (test('Limitations: every deferred row has non-empty description and a tracking pointer', () => {
    const tables = parseTablesInSection(limitations, '## What is deferred to v1.1');
    assert.ok(tables.length >= 1, 'expected at least one table in deferred section');
    const rows = tables[0].slice(1);

    assert.ok(rows.length >= 1, 'expected at least one deferred row');

    for (const row of rows) {
      assert.ok(row.length >= 3, `deferred row malformed (got ${row.length} cells): ${JSON.stringify(row)}`);
      const capability = row[0];
      const reason = row[1];
      const tracking = row[2];
      assert.ok(capability && capability.length > 0, `deferred row missing capability: ${JSON.stringify(row)}`);
      assert.ok(reason && reason.length > 0, `deferred row missing reason for "${capability}"`);
      assert.ok(tracking && tracking.length > 0, `deferred row missing tracking for "${capability}"`);
      const ok =
        /v1\.1 plan/i.test(tracking) || /\.claude\/plan\//.test(tracking);
      assert.ok(
        ok,
        `deferred row "${capability}" tracking column must reference "v1.1 plan" or a path under .claude/plan/ (got: "${tracking}")`
      );
    }
  })) passed++; else failed++;

  if (test('Guide: every triage-table reason is in enum or explicitly reserved', () => {
    const tables = parseTablesInSection(guide, '## Conflict triage');
    assert.ok(tables.length >= 1, 'expected the conflict-triage table');
    const rows = tables[0].slice(1);

    for (const row of rows) {
      const reasonCell = row[0];
      const reasons = [];
      const re = /`([a-z][a-z0-9-]+)`/g;
      let m;
      while ((m = re.exec(reasonCell)) !== null) reasons.push(m[1]);
      assert.ok(
        reasons.length > 0,
        `triage row first cell does not contain a backticked reason: "${reasonCell}"`
      );
      const meansCell = (row[1] || '').toLowerCase();
      const reserved = meansCell.includes('reserved');
      for (const r of reasons) {
        if (enumValues.includes(r)) continue;
        assert.ok(
          reserved,
          `triage-table reason \`${r}\` is not in enum and is not marked reserved in the "what it means" column`
        );
      }
    }
  })) passed++; else failed++;

  if (test('Neither doc contains <filename>.<ext>:<lineno> line-number rot', () => {
    const rotRe = /[a-zA-Z_-]+\.(?:js|json|md):\d+/g;
    const limMatches = limitations.match(rotRe) || [];
    const guideMatches = guide.match(rotRe) || [];
    assert.deepStrictEqual(
      limMatches,
      [],
      `PROFILE-LIMITATIONS.md contains line-number references: ${limMatches.join(', ')}`
    );
    assert.deepStrictEqual(
      guideMatches,
      [],
      `PROFILE-SAFETY-GUIDE.md contains line-number references: ${guideMatches.join(', ')}`
    );
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
