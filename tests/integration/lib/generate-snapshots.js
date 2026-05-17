'use strict';

const path = require('path');
const { resolveInstallPlan } = require('../../../scripts/lib/install-manifests');
const { buildPlanDocument } = require('../../../scripts/lib/install/plan-operations');
const { getInstallTargetAdapter } = require('../../../scripts/lib/install-targets/registry');
const { normalizePlanDocument, writeSnapshot } = require('./snapshot-helper');

const REPO_ROOT = path.join(__dirname, '../../..');
const HOME_DIR = '/FIXTURE-HOME';
const PROJECT_ROOT = '/FIXTURE-PROJECT';

const MATRIX = [
  // 5 general profiles x {claude, codex}
  ['minimal', 'claude'], ['minimal', 'codex'],
  ['core', 'claude'], ['core', 'codex'],
  ['developer', 'claude'], ['developer', 'codex'],
  ['security', 'claude'], ['security', 'codex'],
  ['research', 'claude'], ['research', 'codex'],
  // document-ai x {claude, codex}
  ['document-ai', 'claude'], ['document-ai', 'codex'],
  // enterprise x {claude, codex}
  ['enterprise', 'claude'], ['enterprise', 'codex'],
];

function buildSnapshot(profileId, target) {
  const resolved = resolveInstallPlan({ profileId, target, homeDir: HOME_DIR, projectRoot: PROJECT_ROOT });
  const adapter = getInstallTargetAdapter(target);
  const planDoc = buildPlanDocument(resolved, adapter, {
    scope: null,
    planningInput: { homeDir: HOME_DIR, projectRoot: PROJECT_ROOT, repoRoot: REPO_ROOT, targetRoot: resolved.targetRoot },
    profileSettings: resolved.profileSettings,
    repoVersion: null,
  });
  return normalizePlanDocument(planDoc, { homeDir: HOME_DIR, projectRoot: PROJECT_ROOT, repoRoot: REPO_ROOT });
}

function snapshotPath(profileId, target) {
  return path.join(REPO_ROOT, 'tests', 'snapshots', profileId, `install-plan.${target}.json`);
}

if (require.main === module) {
  for (const [profileId, target] of MATRIX) {
    const snap = buildSnapshot(profileId, target);
    const text = JSON.stringify(snap, null, 2) + '\n';
    writeSnapshot(snapshotPath(profileId, target), text);
    process.stdout.write(`wrote ${path.relative(REPO_ROOT, snapshotPath(profileId, target))}\n`);
  }
}

module.exports = { buildSnapshot, snapshotPath, MATRIX, HOME_DIR, PROJECT_ROOT, REPO_ROOT };
