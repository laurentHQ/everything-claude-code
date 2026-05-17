#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '../..');
const DEFAULT_REPORT_PATH = path.join(REPO_ROOT, 'gates-report.json');

function runChildScript(scriptRelPath, args = []) {
  const result = spawnSync('node', [path.join(REPO_ROOT, scriptRelPath), ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

function gateSchemaValidation() {
  const r = runChildScript('scripts/ci/validate-install-manifests.js');
  return r.status === 0
    ? { gate: 'schema', status: 'pass' }
    : { gate: 'schema', status: 'fail', detail: r.stderr.trim() || r.stdout.trim() };
}

function gateSnapshotMatch() {
  const r = runChildScript('tests/integration/install-plan-snapshots.test.js');
  return r.status === 0
    ? { gate: 'snapshot', status: 'pass' }
    : { gate: 'snapshot', status: 'fail', detail: r.stdout.split('\n').slice(-20).join('\n') };
}

function gatePolicyClean() {
  // For each promoted profile, build the default plan and assert no
  // severity:"error" conflicts. We piggyback on the snapshot test which
  // already does plan-document construction across the matrix; if any
  // promoted profile would refuse a default install, snapshot regeneration
  // would have failed. As a direct check, also exercise evaluatePolicy
  // against each profile with default settings.
  const { resolveInstallPlan, loadInstallManifests } = require(path.join(REPO_ROOT, 'scripts/lib/install-manifests'));
  const { evaluatePolicy } = require(path.join(REPO_ROOT, 'scripts/lib/install/policy'));
  const manifests = loadInstallManifests();
  const failures = [];
  for (const [profileId, profile] of Object.entries(manifests.profiles)) {
    const settings = (profile.settings) || {};
    if (settings.lifecycle !== 'promoted') continue;
    for (const target of (Array.isArray(profile.targets) ? profile.targets : ['claude'])) {
      try {
        const resolved = resolveInstallPlan({ profileId, target });
        const { conflicts } = evaluatePolicy(resolved, resolved.profileSettings || null);
        const blocking = conflicts.filter(c => c && c.severity === 'error');
        if (blocking.length > 0) {
          failures.push({ profileId, target, conflicts: blocking.map(c => c.reason) });
        }
      } catch (error) {
        failures.push({ profileId, target, error: error.message });
      }
    }
  }
  return failures.length === 0
    ? { gate: 'policy', status: 'pass' }
    : { gate: 'policy', status: 'fail', detail: JSON.stringify(failures) };
}

function gateSecretScan() {
  const r = runChildScript('scripts/ci/scan-secret-shapes.js');
  return r.status === 0
    ? { gate: 'secret-scan', status: 'pass' }
    : { gate: 'secret-scan', status: 'fail', detail: r.stderr.trim() };
}

function gateRoundTrip() {
  const r = runChildScript('tests/integration/round-trip-audit-on.test.js');
  return r.status === 0
    ? { gate: 'round-trip', status: 'pass' }
    : { gate: 'round-trip', status: 'fail', detail: r.stdout.split('\n').slice(-20).join('\n') };
}

const DEFAULT_GATE_RUNNERS = {
  schema: gateSchemaValidation,
  snapshot: gateSnapshotMatch,
  policy: gatePolicyClean,
  'secret-scan': gateSecretScan,
  'round-trip': gateRoundTrip,
};

function runGates(options = {}) {
  const stubs = (options && options.stubs) || {};
  const order = ['schema', 'snapshot', 'policy', 'secret-scan', 'round-trip'];
  const gates = order.map(name => {
    const runner = stubs[name] || DEFAULT_GATE_RUNNERS[name];
    const result = runner();
    // Allow stubs to omit the `gate` field; backfill from the registered key.
    return Object.assign({ gate: name }, result);
  });
  const passed = gates.every(g => g.status === 'pass');
  const report = {
    generatedAt: new Date().toISOString(),
    gates,
    passed,
  };
  if (options.reportPath !== null && options.reportPath !== undefined) {
    fs.writeFileSync(options.reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  } else if (options.reportPath === undefined) {
    fs.writeFileSync(DEFAULT_REPORT_PATH, JSON.stringify(report, null, 2) + '\n', 'utf8');
  }
  return report;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const reportArgIdx = args.indexOf('--report');
  const reportPath = reportArgIdx >= 0 ? args[reportArgIdx + 1] : undefined;
  const report = runGates({ reportPath });
  for (const g of report.gates) {
    process.stdout.write(`[gate:${g.gate}] ${g.status}${g.detail ? ' — ' + g.detail.split('\n')[0] : ''}\n`);
  }
  process.exit(report.passed ? 0 : 1);
}

module.exports = {
  runGates,
  gateSchemaValidation,
  gateSnapshotMatch,
  gatePolicyClean,
  gateSecretScan,
  gateRoundTrip,
  DEFAULT_REPORT_PATH,
};
