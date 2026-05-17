/**
 * Tests for profile settings exposed by scripts/lib/install-manifests.js.
 *
 * Covers getProfileSettings, listInstallProfiles, and resolveInstallPlan
 * extensions added for the profile-deploy MVP (T1).
 */

const assert = require('assert');

const {
  getProfileSettings,
  listInstallProfiles,
  resolveInstallPlan,
} = require('../../scripts/lib/install-manifests');

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

function runTests() {
  console.log('\n=== Testing install-manifests profile settings ===\n');

  let passed = 0;
  let failed = 0;

  if (test('getProfileSettings("minimal") returns the configured low-context settings', () => {
    const settings = getProfileSettings('minimal');
    assert.ok(settings && typeof settings === 'object', 'Expected object');
    assert.strictEqual(settings.hook_profile, 'none');
    assert.strictEqual(settings.scope, 'project');
    assert.strictEqual(settings.allow_mcp, false);
    assert.strictEqual(settings.write_scope, 'project-only');
    assert.strictEqual(settings.require_dry_run_first, true);
    assert.strictEqual(settings.lifecycle, 'draft');
  })) passed++; else failed++;

  if (test('getProfileSettings("core") returns standard hook profile', () => {
    const settings = getProfileSettings('core');
    assert.ok(settings);
    assert.strictEqual(settings.hook_profile, 'standard');
    assert.strictEqual(settings.allow_mcp, false);
    assert.strictEqual(settings.require_dry_run_first, true);
    assert.strictEqual(settings.lifecycle, 'draft');
  })) passed++; else failed++;

  if (test('getProfileSettings("full") returns minimal-change shape (draft lifecycle)', () => {
    const settings = getProfileSettings('full');
    // The MVP keeps full minimal — it either has only {lifecycle:"draft"} or null.
    if (settings === null) {
      assert.strictEqual(settings, null);
    } else {
      assert.deepStrictEqual(Object.keys(settings).sort(), ['lifecycle']);
      assert.strictEqual(settings.lifecycle, 'draft');
    }
  })) passed++; else failed++;

  if (test('getProfileSettings("document-ai") declares validation hook + audit log', () => {
    const settings = getProfileSettings('document-ai');
    assert.ok(settings);
    assert.strictEqual(settings.hook_profile, 'validation');
    assert.strictEqual(settings.require_audit_log, true);
    assert.strictEqual(settings.require_dry_run_first, true);
    assert.strictEqual(settings.write_scope, 'project-local');
    assert.strictEqual(settings.allow_mcp, false);
  })) passed++; else failed++;

  if (test('getProfileSettings("enterprise") returns allow_mcp:true with curated allowlist', () => {
    const settings = getProfileSettings('enterprise');
    assert.ok(settings);
    assert.strictEqual(settings.allow_mcp, true);
    assert.deepStrictEqual(settings.allowed_mcp_servers, ['context7', 'github']);
    assert.strictEqual(settings.hook_profile, 'strict');
    assert.strictEqual(settings.write_scope, 'controlled');
    assert.strictEqual(settings.require_audit_log, true);
  })) passed++; else failed++;

  if (test('getProfileSettings("does-not-exist") throws Unknown install profile', () => {
    assert.throws(
      () => getProfileSettings('does-not-exist'),
      /Unknown install profile: does-not-exist/
    );
  })) passed++; else failed++;

  if (test('resolveInstallPlan({profileId:"security"}) surfaces profileSettings.hook_profile=strict', () => {
    const plan = resolveInstallPlan({ profileId: 'security' });
    assert.ok(plan.profileSettings, 'Expected profileSettings');
    assert.strictEqual(plan.profileSettings.hook_profile, 'strict');
    assert.strictEqual(plan.profileSettings.block_global_install, true);
    assert.strictEqual(plan.profileSettings.require_audit_log, true);
  })) passed++; else failed++;

  if (test('resolveInstallPlan without profileId yields profileSettings:null', () => {
    const plan = resolveInstallPlan({ moduleIds: ['rules-core'] });
    assert.strictEqual(plan.profileSettings, null);
  })) passed++; else failed++;

  if (test('listInstallProfiles entries include settings and targets fields', () => {
    const profiles = listInstallProfiles();
    const minimal = profiles.find(p => p.id === 'minimal');
    assert.ok(minimal, 'Should include minimal');
    assert.ok(Object.prototype.hasOwnProperty.call(minimal, 'settings'));
    assert.ok(Object.prototype.hasOwnProperty.call(minimal, 'targets'));
    assert.ok(Array.isArray(minimal.targets));
    assert.ok(minimal.targets.includes('claude'));
    assert.strictEqual(minimal.settings.hook_profile, 'none');

    const full = profiles.find(p => p.id === 'full');
    assert.ok(full, 'Should include full');
    // full has no targets (we omitted it)
    assert.strictEqual(full.targets, null);
    // settings is either null or {lifecycle:"draft"} per MVP choice
    if (full.settings !== null) {
      assert.strictEqual(full.settings.lifecycle, 'draft');
    }
  })) passed++; else failed++;

  if (test('listInstallProfiles includes new document-ai and enterprise entries', () => {
    const profiles = listInstallProfiles();
    const ids = profiles.map(p => p.id);
    assert.ok(ids.includes('document-ai'), `Expected document-ai in ${ids.join(',')}`);
    assert.ok(ids.includes('enterprise'), `Expected enterprise in ${ids.join(',')}`);
  })) passed++; else failed++;

  if (test('mutating returned settings object does not affect subsequent calls', () => {
    const first = getProfileSettings('enterprise');
    first.allowed_mcp_servers.push('intruder');
    first.hook_profile = 'mutated';
    const second = getProfileSettings('enterprise');
    assert.deepStrictEqual(second.allowed_mcp_servers, ['context7', 'github']);
    assert.strictEqual(second.hook_profile, 'strict');
  })) passed++; else failed++;

  if (test('mutating settings from listInstallProfiles does not bleed into next call', () => {
    const first = listInstallProfiles().find(p => p.id === 'minimal');
    first.settings.hook_profile = 'mutated';
    first.targets.push('mystery');
    const second = listInstallProfiles().find(p => p.id === 'minimal');
    assert.strictEqual(second.settings.hook_profile, 'none');
    assert.ok(!second.targets.includes('mystery'));
  })) passed++; else failed++;

  if (test('mutating profileSettings from resolveInstallPlan does not bleed into next call', () => {
    const first = resolveInstallPlan({ profileId: 'enterprise' });
    first.profileSettings.allowed_mcp_servers.push('intruder');
    const second = resolveInstallPlan({ profileId: 'enterprise' });
    assert.deepStrictEqual(second.profileSettings.allowed_mcp_servers, ['context7', 'github']);
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
