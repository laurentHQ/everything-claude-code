const fs = require('fs');
const path = require('path');

// Hard dependency: ajv is required to validate install-state documents
// against schemas/install-state.schema.json (which $refs install-settings
// and install-operations). The earlier hand-rolled fallback validator was
// removed in Wave 0 (I10) — `ajv` is declared in package.json so the
// dependency is satisfied for any normal install.
const Ajv = require('ajv');

const SCHEMA_DIR = path.join(__dirname, '..', '..', 'schemas');
const SCHEMA_PATH = path.join(SCHEMA_DIR, 'install-state.schema.json');

const SCHEMA_VERSION = 'ecc.install.v2';

let cachedValidator = null;

function cloneJsonValue(value) {
  if (value === undefined) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(value));
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to read ${label}: ${error.message}`);
  }
}

function getValidator() {
  if (cachedValidator) {
    return cachedValidator;
  }

  const ajv = new Ajv({ allErrors: true });
  // Pre-register the $ref'd shared schemas so the install-state schema's
  // "install-settings.schema.json" + "install-operations.schema.json#/..."
  // references resolve at compile time.
  ajv.addSchema(readJson(path.join(SCHEMA_DIR, 'install-settings.schema.json'), 'install-settings schema'));
  ajv.addSchema(readJson(path.join(SCHEMA_DIR, 'install-operations.schema.json'), 'install-operations schema'));
  const schema = readJson(SCHEMA_PATH, 'install-state schema');
  cachedValidator = ajv.compile(schema);
  return cachedValidator;
}


function formatValidationErrors(errors = []) {
  return errors
    .map(error => `${error.instancePath || '/'} ${error.message}`)
    .join('; ');
}

function validateInstallState(state) {
  const validator = getValidator();
  const valid = validator(state);
  return {
    valid,
    errors: validator.errors || [],
  };
}

function assertValidInstallState(state, label) {
  const result = validateInstallState(state);
  if (!result.valid) {
    throw new Error(`Invalid install-state${label ? ` (${label})` : ''}: ${formatValidationErrors(result.errors)}`);
  }
}

/**
 * Migrate an install-state document to the current SCHEMA_VERSION.
 *   - v2 input: returned unchanged (identity).
 *   - v1 input: shallow-clone with schemaVersion bumped to v2. v1 fields are
 *     a strict subset of v2 (settings + backups are optional in v2), so no
 *     other transform is needed.
 *   - Unknown schemaVersion: warns to stderr and returns the input unchanged
 *     so the downstream validator surfaces a "must equal ecc.install.v2"
 *     error. The warning keeps the failure diagnosable when a future v3
 *     state lands without an updated client.
 *   - Non-object input: throws.
 */
function migrateInstallState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new Error('Cannot migrate install-state: input is not a JSON object');
  }

  if (state.schemaVersion === SCHEMA_VERSION) {
    return state;
  }

  if (state.schemaVersion === 'ecc.install.v1') {
    return { ...state, schemaVersion: SCHEMA_VERSION };
  }

  process.stderr.write(
    `[install-state] unknown schemaVersion ${JSON.stringify(state.schemaVersion)}; ` +
    `known versions: ecc.install.v1, ${SCHEMA_VERSION}. Passing through; validator will reject.\n`
  );
  return state;
}

function createInstallState(options) {
  const installedAt = options.installedAt || new Date().toISOString();
  const state = {
    schemaVersion: SCHEMA_VERSION,
    installedAt,
    target: {
      id: options.adapter.id,
      target: options.adapter.target || undefined,
      kind: options.adapter.kind || undefined,
      root: options.targetRoot,
      installStatePath: options.installStatePath,
    },
    request: {
      profile: options.request.profile || null,
      modules: Array.isArray(options.request.modules) ? [...options.request.modules] : [],
      includeComponents: Array.isArray(options.request.includeComponents)
        ? [...options.request.includeComponents]
        : [],
      excludeComponents: Array.isArray(options.request.excludeComponents)
        ? [...options.request.excludeComponents]
        : [],
      legacyLanguages: Array.isArray(options.request.legacyLanguages)
        ? [...options.request.legacyLanguages]
        : [],
      legacyMode: Boolean(options.request.legacyMode),
    },
    resolution: {
      selectedModules: Array.isArray(options.resolution.selectedModules)
        ? [...options.resolution.selectedModules]
        : [],
      skippedModules: Array.isArray(options.resolution.skippedModules)
        ? [...options.resolution.skippedModules]
        : [],
    },
    source: {
      repoVersion: options.source.repoVersion || null,
      repoCommit: options.source.repoCommit || null,
      manifestVersion: options.source.manifestVersion,
    },
    operations: Array.isArray(options.operations)
      ? options.operations.map(operation => cloneJsonValue(operation))
      : [],
  };

  if (options.lastValidatedAt) {
    state.lastValidatedAt = options.lastValidatedAt;
  }

  if (options.settings !== undefined && options.settings !== null) {
    state.settings = cloneJsonValue(options.settings);
  }

  if (options.backups !== undefined && options.backups !== null) {
    state.backups = Array.isArray(options.backups)
      ? options.backups.map(entry => cloneJsonValue(entry))
      : cloneJsonValue(options.backups);
  }

  assertValidInstallState(state, 'create');
  return state;
}

function readInstallState(filePath) {
  const raw = readJson(filePath, 'install-state');
  const state = migrateInstallState(raw);
  assertValidInstallState(state, filePath);
  return state;
}

function writeInstallState(filePath, state) {
  assertValidInstallState(state, filePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`);
  return state;
}

module.exports = {
  createInstallState,
  migrateInstallState,
  readInstallState,
  validateInstallState,
  writeInstallState,
  SCHEMA_VERSION,
};
