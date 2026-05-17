'use strict';

const { readJsonFile, writeJsonFile } = require('../json-format');

const STATES = ['draft', 'candidate', 'promoted'];
const ALLOWED_FORWARD = {
  draft: ['candidate'],
  candidate: ['promoted'],
  promoted: [],
};

function isKnownState(state) {
  return STATES.includes(state);
}

/**
 * Validate a transition request. Returns { allowed, reason }.
 *  - Forward transitions follow ALLOWED_FORWARD.
 *  - Backwards transitions require options.force === true.
 *  - Unknown states are rejected.
 *  - Same-state transitions are allowed (idempotent).
 */
function validateTransition(from, to, options = {}) {
  if (!isKnownState(from)) return { allowed: false, reason: `unknown source state: ${from}` };
  if (!isKnownState(to)) return { allowed: false, reason: `unknown target state: ${to}` };
  if (from === to) return { allowed: true, reason: 'idempotent' };
  if ((ALLOWED_FORWARD[from] || []).includes(to)) return { allowed: true, reason: 'forward' };
  // Backwards or skip-ahead
  if (options.force === true) return { allowed: true, reason: 'forced' };
  return { allowed: false, reason: `transition ${from} -> ${to} requires --force` };
}

/**
 * Apply a transition by editing manifests/install-profiles.json in place.
 * Returns { from, to, manifestPath, applied: true } on success.
 * Throws on invalid input or disallowed transition (without --force).
 *
 * If options.dryRun is true, returns { from, to, manifestPath, applied: false }
 * without writing.
 */
function applyTransition(manifestPath, profileId, toState, options = {}) {
  if (typeof manifestPath !== 'string' || !manifestPath) throw new Error('manifestPath required');
  if (typeof profileId !== 'string' || !profileId) throw new Error('profileId required');
  if (!isKnownState(toState)) throw new Error(`unknown target state: ${toState}`);

  const manifest = readJsonFile(manifestPath);
  const profile = manifest && manifest.profiles && manifest.profiles[profileId];
  if (!profile) throw new Error(`profile not found in manifest: ${profileId}`);

  const settings = profile.settings || {};
  const fromState = settings.lifecycle || 'draft';

  const decision = validateTransition(fromState, toState, options);
  if (!decision.allowed) {
    throw new Error(`lifecycle transition refused: ${decision.reason}`);
  }

  if (options.dryRun) {
    return { from: fromState, to: toState, manifestPath, applied: false, reason: decision.reason };
  }

  // Mutate IN PLACE, preserving key order. Build new settings object that
  // matches the prior key order with lifecycle updated/added at its existing
  // position (or appended if not present).
  const updatedSettings = { ...settings, lifecycle: toState };
  profile.settings = updatedSettings;

  writeJsonFile(manifestPath, manifest);

  return { from: fromState, to: toState, manifestPath, applied: true, reason: decision.reason };
}

module.exports = { STATES, ALLOWED_FORWARD, isKnownState, validateTransition, applyTransition };
