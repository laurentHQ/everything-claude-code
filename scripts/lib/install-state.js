const fs = require('fs');
const path = require('path');

let Ajv = null;
try {
  // Prefer schema-backed validation when dependencies are installed.
  // The fallback validator below keeps source checkouts usable in bare environments.
  const ajvModule = require('ajv');
  Ajv = ajvModule.default || ajvModule;
} catch (_error) {
  Ajv = null;
}

const SCHEMA_PATH = path.join(__dirname, '..', '..', 'schemas', 'install-state.schema.json');

const SCHEMA_VERSION = 'ecc.install.v2';
const KNOWN_OPERATION_KINDS = new Set([
  'copy-file',
  'copy-path',
  'merge-json',
  'copy-tree',
  'flatten-copy',
  'render-template',
  'merge-jsonc',
  'mkdir',
  'remove',
]);

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

  if (Ajv) {
    const schema = readJson(SCHEMA_PATH, 'install-state schema');
    const ajv = new Ajv({ allErrors: true });
    cachedValidator = ajv.compile(schema);
    return cachedValidator;
  }

  cachedValidator = createFallbackValidator();
  return cachedValidator;
}

function createFallbackValidator() {
  const validate = state => {
    const errors = [];
    validate.errors = errors;

    function pushError(instancePath, message) {
      errors.push({
        instancePath,
        message,
      });
    }

    function isNonEmptyString(value) {
      return typeof value === 'string' && value.length > 0;
    }

    function validateNoAdditionalProperties(value, instancePath, allowedKeys) {
      for (const key of Object.keys(value)) {
        if (!allowedKeys.includes(key)) {
          pushError(`${instancePath}/${key}`, 'must NOT have additional properties');
        }
      }
    }

    function validateStringArray(value, instancePath) {
      if (!Array.isArray(value)) {
        pushError(instancePath, 'must be array');
        return;
      }

      for (let index = 0; index < value.length; index += 1) {
        if (!isNonEmptyString(value[index])) {
          pushError(`${instancePath}/${index}`, 'must be non-empty string');
        }
      }
    }

    function validateOptionalString(value, instancePath) {
      if (value !== undefined && value !== null && !isNonEmptyString(value)) {
        pushError(instancePath, 'must be string or null');
      }
    }

    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      pushError('/', 'must be object');
      return false;
    }

    validateNoAdditionalProperties(
      state,
      '',
      [
        'schemaVersion',
        'installedAt',
        'lastValidatedAt',
        'target',
        'request',
        'resolution',
        'source',
        'operations',
        'settings',
        'backups',
      ]
    );

    if (state.schemaVersion !== SCHEMA_VERSION) {
      pushError('/schemaVersion', `must equal ${SCHEMA_VERSION}`);
    }

    if (!isNonEmptyString(state.installedAt)) {
      pushError('/installedAt', 'must be non-empty string');
    }

    if (state.lastValidatedAt !== undefined && !isNonEmptyString(state.lastValidatedAt)) {
      pushError('/lastValidatedAt', 'must be non-empty string');
    }

    const target = state.target;
    if (!target || typeof target !== 'object' || Array.isArray(target)) {
      pushError('/target', 'must be object');
    } else {
      validateNoAdditionalProperties(target, '/target', ['id', 'target', 'kind', 'root', 'installStatePath']);
      if (!isNonEmptyString(target.id)) {
        pushError('/target/id', 'must be non-empty string');
      }
      validateOptionalString(target.target, '/target/target');
      if (target.kind !== undefined && !['home', 'project'].includes(target.kind)) {
        pushError('/target/kind', 'must be equal to one of the allowed values');
      }
      if (!isNonEmptyString(target.root)) {
        pushError('/target/root', 'must be non-empty string');
      }
      if (!isNonEmptyString(target.installStatePath)) {
        pushError('/target/installStatePath', 'must be non-empty string');
      }
    }

    const request = state.request;
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      pushError('/request', 'must be object');
    } else {
      validateNoAdditionalProperties(
        request,
        '/request',
        ['profile', 'modules', 'includeComponents', 'excludeComponents', 'legacyLanguages', 'legacyMode']
      );
      if (!(Object.prototype.hasOwnProperty.call(request, 'profile') && (request.profile === null || typeof request.profile === 'string'))) {
        pushError('/request/profile', 'must be string or null');
      }
      validateStringArray(request.modules, '/request/modules');
      validateStringArray(request.includeComponents, '/request/includeComponents');
      validateStringArray(request.excludeComponents, '/request/excludeComponents');
      validateStringArray(request.legacyLanguages, '/request/legacyLanguages');
      if (typeof request.legacyMode !== 'boolean') {
        pushError('/request/legacyMode', 'must be boolean');
      }
    }

    const resolution = state.resolution;
    if (!resolution || typeof resolution !== 'object' || Array.isArray(resolution)) {
      pushError('/resolution', 'must be object');
    } else {
      validateNoAdditionalProperties(resolution, '/resolution', ['selectedModules', 'skippedModules']);
      validateStringArray(resolution.selectedModules, '/resolution/selectedModules');
      validateStringArray(resolution.skippedModules, '/resolution/skippedModules');
    }

    const source = state.source;
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      pushError('/source', 'must be object');
    } else {
      validateNoAdditionalProperties(source, '/source', ['repoVersion', 'repoCommit', 'manifestVersion']);
      validateOptionalString(source.repoVersion, '/source/repoVersion');
      validateOptionalString(source.repoCommit, '/source/repoCommit');
      if (!Number.isInteger(source.manifestVersion) || source.manifestVersion < 1) {
        pushError('/source/manifestVersion', 'must be integer >= 1');
      }
    }

    if (state.settings !== undefined) {
      const settings = state.settings;
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
        pushError('/settings', 'must be object');
      } else {
        validateNoAdditionalProperties(
          settings,
          '/settings',
          [
            'scope',
            'hook_profile',
            'allow_mcp',
            'allowed_mcp_servers',
            'require_dry_run_first',
            'require_audit_log',
            'block_global_install',
            'write_scope',
            'lifecycle',
          ]
        );
        if (settings.scope !== undefined && !['project', 'user', 'sandbox'].includes(settings.scope)) {
          pushError('/settings/scope', 'must be project|user|sandbox');
        }
        if (
          settings.hook_profile !== undefined
          && !['none', 'standard', 'strict', 'validation'].includes(settings.hook_profile)
        ) {
          pushError('/settings/hook_profile', 'must be none|standard|strict|validation');
        }
        if (settings.allow_mcp !== undefined && typeof settings.allow_mcp !== 'boolean') {
          pushError('/settings/allow_mcp', 'must be boolean');
        }
        if (settings.allowed_mcp_servers !== undefined) {
          if (!Array.isArray(settings.allowed_mcp_servers)) {
            pushError('/settings/allowed_mcp_servers', 'must be array');
          } else {
            settings.allowed_mcp_servers.forEach((value, index) => {
              if (typeof value !== 'string' || !/^[a-z0-9_-]+$/.test(value)) {
                pushError(`/settings/allowed_mcp_servers/${index}`, 'must match pattern');
              }
            });
          }
        }
        if (settings.require_dry_run_first !== undefined && typeof settings.require_dry_run_first !== 'boolean') {
          pushError('/settings/require_dry_run_first', 'must be boolean');
        }
        if (settings.require_audit_log !== undefined && typeof settings.require_audit_log !== 'boolean') {
          pushError('/settings/require_audit_log', 'must be boolean');
        }
        if (settings.block_global_install !== undefined && typeof settings.block_global_install !== 'boolean') {
          pushError('/settings/block_global_install', 'must be boolean');
        }
        if (
          settings.write_scope !== undefined
          && !['project-only', 'project-local', 'controlled'].includes(settings.write_scope)
        ) {
          pushError('/settings/write_scope', 'must be project-only|project-local|controlled');
        }
        if (
          settings.lifecycle !== undefined
          && !['draft', 'candidate', 'promoted'].includes(settings.lifecycle)
        ) {
          pushError('/settings/lifecycle', 'must be draft|candidate|promoted');
        }
      }
    }

    if (state.backups !== undefined) {
      if (!Array.isArray(state.backups)) {
        pushError('/backups', 'must be array');
      } else {
        state.backups.forEach((entry, index) => {
          const entryPath = `/backups/${index}`;
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            pushError(entryPath, 'must be object');
            return;
          }
          validateNoAdditionalProperties(entry, entryPath, ['destination', 'backupPath', 'recordedAt']);
          if (!isNonEmptyString(entry.destination)) {
            pushError(`${entryPath}/destination`, 'must be non-empty string');
          }
          if (!isNonEmptyString(entry.backupPath)) {
            pushError(`${entryPath}/backupPath`, 'must be non-empty string');
          }
          if (!isNonEmptyString(entry.recordedAt)) {
            pushError(`${entryPath}/recordedAt`, 'must be non-empty string');
          }
        });
      }
    }

    if (!Array.isArray(state.operations)) {
      pushError('/operations', 'must be array');
    } else {
      for (let index = 0; index < state.operations.length; index += 1) {
        const operation = state.operations[index];
        const instancePath = `/operations/${index}`;

        if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
          pushError(instancePath, 'must be object');
          continue;
        }

        if (!isNonEmptyString(operation.kind)) {
          pushError(`${instancePath}/kind`, 'must be non-empty string');
        } else if (!KNOWN_OPERATION_KINDS.has(operation.kind)) {
          pushError(`${instancePath}/kind`, `must be one of: ${[...KNOWN_OPERATION_KINDS].join(', ')}`);
        }
        if (!isNonEmptyString(operation.moduleId)) {
          pushError(`${instancePath}/moduleId`, 'must be non-empty string');
        }
        if (!isNonEmptyString(operation.sourceRelativePath)) {
          pushError(`${instancePath}/sourceRelativePath`, 'must be non-empty string');
        }
        if (!isNonEmptyString(operation.destinationPath)) {
          pushError(`${instancePath}/destinationPath`, 'must be non-empty string');
        }
        if (!isNonEmptyString(operation.strategy)) {
          pushError(`${instancePath}/strategy`, 'must be non-empty string');
        }
        if (!isNonEmptyString(operation.ownership)) {
          pushError(`${instancePath}/ownership`, 'must be non-empty string');
        }
        if (typeof operation.scaffoldOnly !== 'boolean') {
          pushError(`${instancePath}/scaffoldOnly`, 'must be boolean');
        }
      }
    }

    return errors.length === 0;
  };

  validate.errors = [];
  return validate;
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
