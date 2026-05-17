'use strict';

const fs = require('fs');
const path = require('path');

// Replace concrete absolute paths in operations[].destinationPath and
// targetRoot/installStatePath with `<HOME>` etc. so the snapshot is
// machine-independent.
function normalizePlanDocument(plan, { homeDir, projectRoot, repoRoot } = {}) {
  const replacements = [];
  if (homeDir) replacements.push([homeDir, '<HOME>']);
  if (projectRoot && projectRoot !== homeDir) replacements.push([projectRoot, '<PROJECT>']);
  if (repoRoot && repoRoot !== homeDir && repoRoot !== projectRoot) replacements.push([repoRoot, '<REPO>']);

  function replaceInString(s) {
    let out = String(s);
    for (const [from, to] of replacements) out = out.split(from).join(to);
    return out;
  }
  function deepReplace(value) {
    if (typeof value === 'string') return replaceInString(value);
    if (Array.isArray(value)) return value.map(deepReplace);
    if (value && typeof value === 'object') {
      const result = {};
      for (const [k, v] of Object.entries(value)) result[k] = deepReplace(v);
      return result;
    }
    return value;
  }
  return deepReplace(plan);
}

function readSnapshotIfExists(snapshotPath) {
  if (!fs.existsSync(snapshotPath)) return null;
  return fs.readFileSync(snapshotPath, 'utf8');
}

function writeSnapshot(snapshotPath, content) {
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  fs.writeFileSync(snapshotPath, content, 'utf8');
}

module.exports = { normalizePlanDocument, readSnapshotIfExists, writeSnapshot };
