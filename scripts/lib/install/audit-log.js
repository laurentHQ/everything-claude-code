'use strict';

const fs = require('fs');
const path = require('path');

const { assertInsideAllowedRoot } = require('./path-safety');

/**
 * Resolve the audit-log path based on profile-settings scope:
 *   scope === 'sandbox' -> <stateDir>/audit.jsonl
 *   scope === 'project' -> <targetRoot>/ecc/audit.jsonl
 *   scope === 'user'    -> <targetRoot>/ecc/audit.jsonl
 * If overridePath is supplied, use it verbatim.
 * If scope is null/undefined, fall back to <targetRoot>/ecc/audit.jsonl.
 */
function resolveAuditLogPath({ scope, stateDir, targetRoot, overridePath } = {}) {
  if (overridePath) {
    return overridePath;
  }
  if (scope === 'sandbox' && stateDir) {
    return path.join(stateDir, 'audit.jsonl');
  }
  if (targetRoot) {
    return path.join(targetRoot, 'ecc', 'audit.jsonl');
  }
  throw new Error('Cannot resolve audit-log path: need targetRoot or overridePath');
}

/**
 * Append-only JSONL writer. Each call writes one line of JSON terminated by '\n'.
 * Caller is responsible for the schema of `event`.
 * Recommended fields: { timestamp, kind, profileId, target, scope, modules, operationCount, ... }
 */
function appendAuditEvent(filePath, event) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const line = JSON.stringify({ timestamp: new Date().toISOString(), ...event }) + '\n';
  fs.appendFileSync(filePath, line, 'utf8');
  return filePath;
}

/**
 * Convenience wrapper: only writes when settings.require_audit_log is true.
 * Returns the written filePath or null if not written.
 *
 * When `allowedRoots` is a non-empty array, the resolved audit path is asserted
 * to live inside one of those roots before any write. This keeps the audit
 * destination inside the same safety envelope that gates regular operations
 * in scripts/lib/install/apply.js.
 */
function maybeAppendAuditEvent({ settings, scope, stateDir, targetRoot, overridePath, allowedRoots, event } = {}) {
  if (!settings || settings.require_audit_log !== true) {
    return null;
  }
  const filePath = resolveAuditLogPath({ scope, stateDir, targetRoot, overridePath });
  if (Array.isArray(allowedRoots) && allowedRoots.length > 0) {
    assertInsideAllowedRoot(filePath, allowedRoots);
  }
  appendAuditEvent(filePath, event);
  return filePath;
}

module.exports = {
  resolveAuditLogPath,
  appendAuditEvent,
  maybeAppendAuditEvent,
};
