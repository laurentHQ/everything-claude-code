'use strict';

const fs = require('fs');
const path = require('path');

const { writeInstallState } = require('../install-state');
const { filterMcpConfig, parseDisabledMcpServers } = require('../mcp-config');
const { assertInsideAllowedRoot } = require('./path-safety');

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
// server list parsed from ECC_DISABLED_MCPS). Behavior is identical to the
// pre-T2 conditional chain — this is a structural refactor, not a behavior
// change.
//
// Pre-handler invariants enforced by applyInstallPlan (NOT by the handler):
//   - assertInsideAllowedRoot(operation.destinationPath, allowedRoots) has run.
//   - fs.mkdirSync(path.dirname(operation.destinationPath), { recursive: true })
//     has run.
//
// `copy-path` aliases `copy-file` because the adapter helpers
// (scripts/lib/install-targets/helpers.js) emit `kind: 'copy-path'` as their
// default. Pre-T2 the catch-all else-branch handled it; we preserve that
// behavior by routing it through the same handler.
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

const DISPATCH = {
  'merge-json': handleMergeJson,
  'copy-file': handleCopyFile,
  'copy-path': handleCopyFile,
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

  return {
    ...plan,
    applied: true,
  };
}

module.exports = {
  applyInstallPlan,
};
