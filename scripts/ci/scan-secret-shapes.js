#!/usr/bin/env node
'use strict';

/**
 * T6 — Secret-shape scanner.
 *
 * Walks a curated set of repository roots looking for strings that match the
 * shape of real-world credentials (GitHub PATs, OpenAI/Anthropic keys, AWS
 * access keys). Lines that contain an env-style placeholder (${VAR} or
 * GitHub Actions ${{ secrets.NAME }}) are skipped — those are the canonical
 * way to reference secrets without committing them.
 *
 * Exit codes:
 *   0 — clean
 *   1 — one or more findings (stderr lists them)
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '../..');
const SCAN_DIRS = ['manifests', 'schemas', 'scripts', 'agents', 'commands', 'skills', 'rules', 'hooks', 'docs'];

const PATTERNS = [
  { name: 'github-token', regex: /\bgh[ps]_[A-Za-z0-9]{20,}\b/ },
  { name: 'openai-key', regex: /\bsk-[A-Za-z0-9]{32,}\b/ },
  { name: 'anthropic-key', regex: /\bsk-ant-[A-Za-z0-9-]{50,}\b/ },
  { name: 'aws-access-key', regex: /\bAKIA[0-9A-Z]{16}\b/ },
];

// Placeholders that should NOT be flagged
const PLACEHOLDER_PATTERNS = [
  /\$\{[A-Z_][A-Z0-9_]*\}/,                       // ${ENV_VAR}
  /\$\{\{\s*secrets\.[A-Za-z0-9_-]+\s*\}\}/,      // ${{ secrets.NAME }} (GitHub Actions)
];

function walkFiles(dir, acc = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_err) {
    return acc;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, acc);
    else if (entry.isFile()) acc.push(full);
  }
  return acc;
}

function scanFile(filePath) {
  let text;
  try { text = fs.readFileSync(filePath, 'utf8'); } catch { return []; }
  const findings = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { name, regex } of PATTERNS) {
      const match = line.match(regex);
      if (!match) continue;
      // Skip if the match is inside a placeholder context on the same line
      const isPlaceholder = PLACEHOLDER_PATTERNS.some(p => p.test(line));
      if (isPlaceholder) continue;
      findings.push({ filePath, line: i + 1, pattern: name, match: match[0] });
    }
  }
  return findings;
}

function runScan({ roots = SCAN_DIRS, repoRoot = REPO_ROOT } = {}) {
  const allFindings = [];
  for (const dir of roots) {
    const abs = path.join(repoRoot, dir);
    if (!fs.existsSync(abs)) continue;
    for (const file of walkFiles(abs)) {
      allFindings.push(...scanFile(file));
    }
  }
  return allFindings;
}

if (require.main === module) {
  const findings = runScan();
  if (findings.length > 0) {
    for (const f of findings) {
      const rel = path.relative(REPO_ROOT, f.filePath);
      console.error(`[secret-shape] ${rel}:${f.line} matches ${f.pattern} pattern`);
    }
    console.error(`scan-secret-shapes: ${findings.length} finding(s); failing.`);
    process.exit(1);
  }
  console.log('scan-secret-shapes: clean');
}

module.exports = { runScan, scanFile, PATTERNS, PLACEHOLDER_PATTERNS };
