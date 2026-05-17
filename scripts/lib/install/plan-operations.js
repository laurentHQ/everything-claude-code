'use strict';

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');

const { isInsideAllowedRoot } = require('./path-safety');

const SCHEMA_DIR = path.join(__dirname, '..', '..', '..', 'schemas');
const PLAN_SCHEMA_PATH = path.join(SCHEMA_DIR, 'install-plan.schema.json');
const OPERATIONS_SCHEMA_PATH = path.join(SCHEMA_DIR, 'install-operations.schema.json');

let cachedPlanValidator = null;

function readJsonSchema(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to load ${label} (${filePath}): ${error.message}`);
  }
}

function getPlanValidator() {
  if (cachedPlanValidator) return cachedPlanValidator;
  const ajv = new Ajv({ allErrors: true });
  ajv.addSchema(readJsonSchema(OPERATIONS_SCHEMA_PATH, 'install-operations schema'));
  cachedPlanValidator = ajv.compile(readJsonSchema(PLAN_SCHEMA_PATH, 'install-plan schema'));
  return cachedPlanValidator;
}

function formatAjvErrors(errors) {
  if (!Array.isArray(errors) || errors.length === 0) return '(no errors)';
  return errors
    .map(err => `${err.instancePath || '/'} ${err.message}${err.params ? ` ${JSON.stringify(err.params)}` : ''}`)
    .join('; ');
}

function assertPlanDocumentValid(doc) {
  const validate = getPlanValidator();
  if (!validate(doc)) {
    throw new Error(
      `buildPlanDocument: produced document does not match schemas/install-plan.schema.json: ${formatAjvErrors(validate.errors)}`
    );
  }
}

/**
 * Sort an operations array deterministically by (moduleId ASC, destinationPath ASC).
 * ASCII / lexicographic. Mutates in place AND returns the array for convenience.
 * Contract: T4's snapshot tests assume this exact sort.
 */
function sortOperations(operations) {
  if (!Array.isArray(operations)) return [];
  operations.sort((a, b) => {
    const left = `${String(a.moduleId || '')} ${String(a.destinationPath || '')}`;
    const right = `${String(b.moduleId || '')} ${String(b.destinationPath || '')}`;
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  });
  return operations;
}

/**
 * buildOperations(resolvedRequest, adapter) → InstallOperation[]
 * resolvedRequest is the shape returned by resolveInstallPlan (has `operations`).
 * Returns a deterministically-sorted SHALLOW COPY (does not mutate input).
 */
function buildOperations(resolvedRequest, _adapter) {
  const ops = Array.isArray(resolvedRequest && resolvedRequest.operations)
    ? resolvedRequest.operations.slice()
    : [];
  return sortOperations(ops);
}

/**
 * Build the canonical install-plan JSON document per schemas/install-plan.schema.json.
 *
 * args:
 *   resolvedRequest — from resolveInstallPlan({ profileId, target, ... })
 *   adapter         — from getInstallTargetAdapter(target) or null
 *   options         — { repoVersion, scope, planningInput, profileSettings }
 *
 * Returns an object matching install-plan.schema.json with:
 *   tool, version, profileId, target, scope, modules, operations, conflicts, warnings, safety
 *
 * Determinism rules:
 *   - operations sorted by (moduleId, destinationPath) via sortOperations
 *   - conflicts sorted by (destination, reason)
 *   - modules array preserves the order from resolvedRequest.selectedModuleIds (already deterministic from manifest order)
 *   - safety keys are emitted in fixed insertion order
 */
function buildPlanDocument(resolvedRequest, adapter, options = {}) {
  const sortedOps = buildOperations(resolvedRequest, adapter);

  const profileSettings = (options.profileSettings && typeof options.profileSettings === 'object')
    ? options.profileSettings
    : (resolvedRequest && resolvedRequest.profileSettings) || null;

  const allowedRoots = adapter && typeof adapter.allowedRoots === 'function'
    ? adapter.allowedRoots('plan', options.planningInput || {})
    : [];

  const conflicts = [];
  let allInsideRoots = true;

  if (Array.isArray(allowedRoots) && allowedRoots.length > 0) {
    for (const op of sortedOps) {
      const inside = isInsideAllowedRoot(op.destinationPath, allowedRoots);
      if (!inside) {
        allInsideRoots = false;
        conflicts.push({
          destination: op.destinationPath,
          moduleId: op.moduleId,
          reason: 'outside-allowed-root',
          severity: 'error',
          resolution: "Move the destination inside an allowed root, or update the adapter's allowedRoots declaration.",
        });
      }
    }
  }

  // Conflict-sort
  conflicts.sort((a, b) => {
    const ka = `${a.destination} ${a.reason}`;
    const kb = `${b.destination} ${b.reason}`;
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    return 0;
  });

  const safety = {
    dryRunRequired: Boolean(profileSettings && profileSettings.require_dry_run_first),
    globalInstallAllowed: !(profileSettings && profileSettings.block_global_install),
    mcpAllowed: Boolean(profileSettings && profileSettings.allow_mcp),
    allDestinationsInsideAllowedRoots:
      (Array.isArray(allowedRoots) && allowedRoots.length === 0) ? true : allInsideRoots,
  };

  const doc = {
    tool: 'ecc',
    version: options.repoVersion || null,
    profileId: resolvedRequest ? (resolvedRequest.profileId || null) : null,
    target: resolvedRequest ? (resolvedRequest.target || null) : null,
    scope: options.scope || null,
    modules: Array.isArray(resolvedRequest && resolvedRequest.selectedModuleIds)
      ? resolvedRequest.selectedModuleIds.slice()
      : [],
    operations: sortedOps,
    conflicts,
    warnings: [],
    safety,
  };

  // I3: enforce schema conformance at runtime — guarantees CLI output, snapshot
  // tests, and downstream consumers see only schema-valid plan documents.
  assertPlanDocumentValid(doc);

  return doc;
}

module.exports = {
  sortOperations,
  buildOperations,
  buildPlanDocument,
  assertPlanDocumentValid,
};
