'use strict';

const fs = require('fs');
const path = require('path');

const { writeInstallState } = require('../install-state');
const { filterMcpConfig, parseDisabledMcpServers } = require('../mcp-config');
const { assertInsideAllowedRoot } = require('./path-safety');
const { maybeAppendAuditEvent } = require('./audit-log');

function readJsonObject(filePath, label) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to parse ${label} at ${filePath}: ${error.message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid ${label} at ${filePath}: expected a JSON object`);
  }

  return parsed;
}

function cloneJsonValue(value) {
  if (value === undefined) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepMergeJson(baseValue, patchValue) {
  if (!isPlainObject(baseValue) || !isPlainObject(patchValue)) {
    return cloneJsonValue(patchValue);
  }

  const merged = { ...baseValue };
  for (const [key, value] of Object.entries(patchValue)) {
    if (isPlainObject(value) && isPlainObject(merged[key])) {
      merged[key] = deepMergeJson(merged[key], value);
    } else {
      merged[key] = cloneJsonValue(value);
    }
  }
  return merged;
}

function formatJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function replacePluginRootPlaceholders(value, pluginRoot) {
  if (!pluginRoot) {
    return value;
  }

  if (typeof value === 'string') {
    return value.split('${CLAUDE_PLUGIN_ROOT}').join(pluginRoot);
  }

  if (Array.isArray(value)) {
    return value.map(item => replacePluginRootPlaceholders(item, pluginRoot));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        replacePluginRootPlaceholders(nestedValue, pluginRoot),
      ])
    );
  }

  return value;
}

function findHooksSourcePath(plan, hooksDestinationPath) {
  const operation = plan.operations.find(item => item.destinationPath === hooksDestinationPath);
  return operation ? operation.sourcePath : null;
}

function isMcpConfigPath(filePath) {
  const basename = path.basename(String(filePath || ''));
  return basename === '.mcp.json' || basename === 'mcp.json';
}

function buildResolvedClaudeHooks(plan) {
  if (!plan.adapter || plan.adapter.target !== 'claude') {
    return null;
  }

  const pluginRoot = plan.targetRoot;
  const hooksDestinationPath = path.join(plan.targetRoot, 'hooks', 'hooks.json');
  const hooksSourcePath = findHooksSourcePath(plan, hooksDestinationPath) || hooksDestinationPath;
  if (!fs.existsSync(hooksSourcePath)) {
    return null;
  }

  const hooksConfig = readJsonObject(hooksSourcePath, 'hooks config');
  const resolvedHooks = replacePluginRootPlaceholders(hooksConfig.hooks, pluginRoot);
  if (!resolvedHooks || typeof resolvedHooks !== 'object' || Array.isArray(resolvedHooks)) {
    throw new Error(`Invalid hooks config at ${hooksSourcePath}: expected "hooks" to be a JSON object`);
  }

  return {
    hooksDestinationPath,
    resolvedHooksConfig: {
      ...hooksConfig,
      hooks: resolvedHooks,
    },
  };
}

// Typed dispatch table for install operations.
//
// Each handler receives (operation, ctx) where ctx supplies request-scoped
// inputs that don't belong on the operation itself (e.g. the disabled-MCP
// server list parsed from ECC_DISABLED_MCPS).
//
// Pre-handler invariants enforced by applyInstallPlan (NOT by the handler):
//   - assertInsideAllowedRoot(operation.destinationPath, allowedRoots) has run.
//   - fs.mkdirSync(path.dirname(operation.destinationPath), { recursive: true })
//     has run.
//
// Aliases (V1 Wave 1 / T2-rest):
//   - `copy-path` aliases `copy-file` because the adapter helpers
//     (scripts/lib/install-targets/helpers.js) emit `kind: 'copy-path'` as
//     their default. Pre-T2 the catch-all else-branch handled it; we preserve
//     that behavior by routing it through the same handler.
//   - `copy-tree` aliases `copy-file` — planner emits one operation per
//     source file under a tree, so each individual op is byte-identical to
//     a single-file copy.
//   - `flatten-copy` aliases `copy-file` — planner has already encoded the
//     flattened destination filename into `destinationPath`, so the apply-time
//     behavior is again a single-file copy.
//
// First-class kinds (V1 Wave 1 / T2-rest):
//   - `render-template`: substitute `{{key}}` placeholders from
//     `operation.context` and write the rendered text to destination.
//   - `merge-jsonc`: JSONC-aware variant of merge-json (strips `//` and
//     `/* */` comments before parsing). Output is plain JSON (we do not
//     preserve comments).
//   - `mkdir`: ensure a directory exists (recursive, idempotent).
//   - `remove`: delete a destination file if present (idempotent).
function handleMergeJson(operation, ctx) {
  const payload = cloneJsonValue(operation.mergePayload);
  if (payload === undefined) {
    throw new Error(`Missing merge payload for ${operation.destinationPath}`);
  }

  const filteredPayload = (
    isMcpConfigPath(operation.destinationPath) && ctx.disabledServers.length > 0
  )
    ? filterMcpConfig(payload, ctx.disabledServers).config
    : payload;

  const currentValue = fs.existsSync(operation.destinationPath)
    ? readJsonObject(operation.destinationPath, 'existing JSON config')
    : {};
  const mergedValue = deepMergeJson(currentValue, filteredPayload);
  fs.writeFileSync(operation.destinationPath, formatJson(mergedValue), 'utf8');
}

function handleCopyFile(operation, ctx) {
  if (isMcpConfigPath(operation.destinationPath) && ctx.disabledServers.length > 0) {
    const sourceConfig = readJsonObject(operation.sourcePath, 'MCP config');
    const filteredConfig = filterMcpConfig(sourceConfig, ctx.disabledServers).config;
    fs.writeFileSync(operation.destinationPath, formatJson(filteredConfig), 'utf8');
    return;
  }
  fs.copyFileSync(operation.sourcePath, operation.destinationPath);
}

function handleRenderTemplate(operation, ctx) {
  if (!operation.sourcePath) {
    throw new Error(`render-template missing sourcePath: ${operation.destinationPath}`);
  }
  const template = fs.readFileSync(operation.sourcePath, 'utf8');
  const context = (operation.context && typeof operation.context === 'object') ? operation.context : {};
  const allowedKeys = Array.isArray(operation.allowedKeys) ? operation.allowedKeys : null;

  // Logic-less Mustache-style: {{ key }} substitution. No conditionals, no loops, no partials.
  // allowedKeys restricts which context keys are interpolatable; an attempt to interpolate
  // a key not in the list throws (defense-in-depth against template-variable leakage).
  const rendered = template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (match, key) => {
    if (allowedKeys && !allowedKeys.includes(key)) {
      throw new Error(`render-template: key "${key}" not in allowedKeys for ${operation.destinationPath}`);
    }
    if (!Object.prototype.hasOwnProperty.call(context, key)) {
      throw new Error(`render-template: missing context key "${key}" for ${operation.destinationPath}`);
    }
    return String(context[key]);
  });

  fs.writeFileSync(operation.destinationPath, rendered, 'utf8');
}

function stripJsonComments(text) {
  // Minimal JSONC stripper: removes // line comments and /* block */ comments.
  // Does NOT handle strings containing // or /* — adequate for our config files
  // which don't use those substrings. If we hit a payload that needs full
  // JSONC parsing in the future, swap to a dedicated parser.
  return String(text)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function handleMergeJsonc(operation, ctx) {
  const payload = cloneJsonValue(operation.mergePayload);
  if (payload === undefined) {
    throw new Error(`Missing merge payload for ${operation.destinationPath}`);
  }
  let currentValue = {};
  if (fs.existsSync(operation.destinationPath)) {
    const text = fs.readFileSync(operation.destinationPath, 'utf8');
    try {
      currentValue = JSON.parse(stripJsonComments(text));
    } catch (error) {
      throw new Error(`merge-jsonc failed to parse ${operation.destinationPath}: ${error.message}`);
    }
  }
  const mergedValue = deepMergeJson(currentValue, payload);
  fs.writeFileSync(operation.destinationPath, formatJson(mergedValue), 'utf8');
}

function handleMkdir(operation, ctx) {
  fs.mkdirSync(operation.destinationPath, { recursive: true });
}

function handleRemove(operation, ctx) {
  if (!fs.existsSync(operation.destinationPath)) {
    return;
  }
  fs.rmSync(operation.destinationPath, { force: true, recursive: false });
}

const DISPATCH = {
  'merge-json': handleMergeJson,
  'merge-jsonc': handleMergeJsonc,
  'copy-file': handleCopyFile,
  'copy-path': handleCopyFile,
  'copy-tree': handleCopyFile,        // alias — see handler comment block
  'flatten-copy': handleCopyFile,     // alias — see handler comment block
  'render-template': handleRenderTemplate,
  'mkdir': handleMkdir,
  'remove': handleRemove,
};

function dispatchOperation(operation, ctx) {
  const handler = DISPATCH[operation.kind];
  if (!handler) {
    throw new Error(
      `Unsupported install operation kind: ${operation.kind} (destination ${operation.destinationPath})`
    );
  }
  handler(operation, ctx);
}

function applyInstallPlan(plan) {
  const resolvedClaudeHooksPlan = buildResolvedClaudeHooks(plan);
  const disabledServers = parseDisabledMcpServers(process.env.ECC_DISABLED_MCPS);
  const allowedRoots = (plan.adapter && typeof plan.adapter.allowedRoots === 'function')
    ? plan.adapter.allowedRoots('apply', {
      homeDir: plan.homeDir,
      projectRoot: plan.projectRoot,
      repoRoot: plan.repoRoot,
      targetRoot: plan.targetRoot,
    })
    : [];

  const ctx = { disabledServers };

  for (const operation of plan.operations) {
    assertInsideAllowedRoot(operation.destinationPath, allowedRoots);
    fs.mkdirSync(path.dirname(operation.destinationPath), { recursive: true });
    dispatchOperation(operation, ctx);
  }

  if (resolvedClaudeHooksPlan) {
    assertInsideAllowedRoot(resolvedClaudeHooksPlan.hooksDestinationPath, allowedRoots);
    fs.mkdirSync(path.dirname(resolvedClaudeHooksPlan.hooksDestinationPath), { recursive: true });
    fs.writeFileSync(
      resolvedClaudeHooksPlan.hooksDestinationPath,
      JSON.stringify(resolvedClaudeHooksPlan.resolvedHooksConfig, null, 2) + '\n',
      'utf8'
    );
  }

  writeInstallState(plan.installStatePath, plan.statePreview);

  try {
    const statePreview = plan.statePreview || {};
    const settings = statePreview.settings || null;
    const request = statePreview.request || {};
    const resolution = statePreview.resolution || {};
    maybeAppendAuditEvent({
      settings,
      scope: (settings && settings.scope) || plan.scope || null,
      stateDir: plan.stateDir || null,
      targetRoot: plan.targetRoot,
      overridePath: plan.auditLogPath || null,
      allowedRoots,
      event: {
        action: 'install-apply',
        profileId: request.profile || null,
        target: plan.adapter && plan.adapter.target ? plan.adapter.target : null,
        modules: Array.isArray(resolution.selectedModules) ? resolution.selectedModules : [],
        operationCount: Array.isArray(plan.operations) ? plan.operations.length : 0,
      },
    });
  } catch (error) {
    process.stderr.write(`[audit-log] failed to append install event: ${error.message}\n`);
  }

  return {
    ...plan,
    applied: true,
  };
}

module.exports = {
  applyInstallPlan,
};

// Internal handlers exposed only for unit-tests of individual operation
// kinds (V1 Wave 1 / T2-rest). Not part of the public surface.
module.exports.__internal = {
  handleRenderTemplate,
  handleMergeJsonc,
  handleMkdir,
  handleRemove,
  stripJsonComments,
};
