'use strict';

/**
 * T6 (V1 Wave 2) — Security Defaults & Policy Gates.
 *
 * Runtime enforcement layer that converts profile-declared safety settings
 * into install-time conflicts. The policy is consulted at two points:
 *
 *   1. buildPlanDocument (plan-operations.js) — surfaces conflicts in the
 *      emitted plan JSON so operators see them before applying.
 *   2. install-apply.js / install-executor.js — refuses to apply any plan
 *      that carries a severity:"error" conflict.
 *
 * Rules:
 *   R1  allow_mcp:false                       → reject any mcp:* component or
 *                                                module whose paths include
 *                                                .mcp.json / mcp.json.
 *   R2  allow_mcp:true + allowed_mcp_servers  → reject mcp:<server> when
 *                                                <server> is not in the
 *                                                allowlist.
 *   R3  block_global_install:true             → reject scope:"user".
 *   R4  hook_profile:"validation"             → reject any kind:"hooks"
 *                                                module declared riskLevel:
 *                                                "high".
 */

function isMcpComponentId(componentId) {
  return typeof componentId === 'string' && componentId.startsWith('mcp:');
}

function moduleTargetsMcpPath(module) {
  if (!module || !Array.isArray(module.paths)) return false;
  return module.paths.some(p => /(^|\/)\.?mcp\.json$/.test(String(p)));
}

function extractMcpServerName(componentId) {
  // 'mcp:context7' -> 'context7'; null if not parseable
  if (!isMcpComponentId(componentId)) return null;
  const name = componentId.slice('mcp:'.length).trim();
  return name.length > 0 ? name : null;
}

/**
 * evaluatePolicy(resolvedRequest, profileSettings)
 *
 * resolvedRequest MUST contain `selectedModules` (full module objects from
 * resolveInstallPlan) — not the string-ID shape from state files. Throws on
 * shape mismatch as a defense-in-depth guard.
 *
 * profileSettings is the 9-key object from getProfileSettings(profileId)
 * or resolveInstallPlan(...).profileSettings; may be null.
 *
 * Returns { conflicts: [...], warnings: [...] } where conflicts contain:
 *   { destination, reason, severity, resolution?, moduleId? }
 */
function evaluatePolicy(resolvedRequest, profileSettings) {
  const conflicts = [];
  const warnings = [];

  if (!resolvedRequest) return { conflicts, warnings };

  // INPUT-SHAPE ASSERTION (defense-in-depth)
  const selectedModules = Array.isArray(resolvedRequest.selectedModules) ? resolvedRequest.selectedModules : [];
  if (selectedModules.length > 0 && (typeof selectedModules[0] !== 'object' || !selectedModules[0].id)) {
    throw new Error(
      'evaluatePolicy: expected full module objects in resolvedRequest.selectedModules, got string IDs. ' +
      'Pass the output of resolveInstallPlan(...) directly; do not read resolution.selectedModules from a state file.'
    );
  }

  const settings = profileSettings || {};
  const includedComponentIds = Array.isArray(resolvedRequest.includedComponentIds) ? resolvedRequest.includedComponentIds : [];
  const scope = resolvedRequest.scope || (settings.scope || null);

  // --- Rule 1: allow_mcp:false rejects any MCP intent ---
  if (settings.allow_mcp === false) {
    for (const cid of includedComponentIds) {
      if (isMcpComponentId(cid)) {
        conflicts.push({
          destination: cid,
          reason: 'mcp-not-allowed',
          severity: 'error',
          resolution: `Profile declares allow_mcp:false. Remove --with ${cid} or pick a profile with allow_mcp:true.`,
          moduleId: cid,
        });
      }
    }
    for (const mod of selectedModules) {
      if (moduleTargetsMcpPath(mod)) {
        conflicts.push({
          destination: (mod.paths || []).find(p => /(^|\/)\.?mcp\.json$/.test(String(p))) || mod.id,
          reason: 'mcp-not-allowed',
          severity: 'error',
          resolution: `Module ${mod.id} targets an .mcp.json/mcp.json path; profile declares allow_mcp:false.`,
          moduleId: mod.id,
        });
      }
    }
  }

  // --- Rule 2: allow_mcp:true + allowed_mcp_servers allowlist enforced ---
  if (settings.allow_mcp === true && Array.isArray(settings.allowed_mcp_servers) && settings.allowed_mcp_servers.length > 0) {
    const allowed = new Set(settings.allowed_mcp_servers);
    for (const cid of includedComponentIds) {
      const server = extractMcpServerName(cid);
      if (server && !allowed.has(server)) {
        conflicts.push({
          destination: cid,
          reason: 'mcp-not-allowed',
          severity: 'error',
          resolution: `Server "${server}" is not in allowed_mcp_servers ${JSON.stringify(settings.allowed_mcp_servers)}.`,
          moduleId: cid,
        });
      }
    }
  }

  // --- Rule 3: block_global_install:true rejects scope:user ---
  if (settings.block_global_install === true && scope === 'user') {
    conflicts.push({
      destination: 'install scope',
      reason: 'global-install-blocked',
      severity: 'error',
      resolution: 'Profile declares block_global_install:true. Re-run with --scope project or --scope sandbox.',
    });
  }

  // --- Rule 4: hook_profile:"validation" rejects high-risk hook modules ---
  if (settings.hook_profile === 'validation') {
    for (const mod of selectedModules) {
      if (mod.kind === 'hooks' && mod.riskLevel === 'high') {
        conflicts.push({
          destination: mod.id,
          reason: 'hook-risk-high',
          severity: 'error',
          resolution: `Hook module ${mod.id} is classified riskLevel:"high"; profile declares hook_profile:"validation".`,
          moduleId: mod.id,
        });
      }
    }
  }

  return { conflicts, warnings };
}

/**
 * assertNoBlockingConflicts(planLike)
 *
 * Accepts either a full plan document ({conflicts:[...]}) or a bare
 * {conflicts:[...]} bag returned by evaluatePolicy. Throws if any conflict
 * has severity:"error", emitting one [policy] stderr line per blocking
 * conflict first so operators see the diagnostic context.
 */
function assertNoBlockingConflicts(planLike) {
  const conflicts = (planLike && Array.isArray(planLike.conflicts)) ? planLike.conflicts : [];
  const blocking = conflicts.filter(c => c && c.severity === 'error');
  if (blocking.length === 0) return;
  for (const c of blocking) {
    process.stderr.write(
      `[policy] refusing install: ${c.reason} (${c.destination})${c.resolution ? ` — ${c.resolution}` : ''}\n`
    );
  }
  throw new Error(`install refused: ${blocking.length} blocking conflict(s) — see [policy] lines on stderr`);
}

module.exports = {
  evaluatePolicy,
  assertNoBlockingConflicts,
  isMcpComponentId,
  moduleTargetsMcpPath,
  extractMcpServerName,
};
