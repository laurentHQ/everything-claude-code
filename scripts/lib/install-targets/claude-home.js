const os = require('os');
const path = require('path');

const {
  createInstallTargetAdapter,
  createRemappedOperation,
  isForeignPlatformPath,
  normalizeRelativePath,
} = require('./helpers');

const CLAUDE_ECC_NAMESPACE = 'ecc';

function buildClaudeAllowedRoots(scope, input, adapter) {
  // Always include the actual root the adapter would resolve to for this invocation.
  // This is the canonical safe root for the current install.
  const planningInput = {
    homeDir: input && input.homeDir,
    projectRoot: input && input.projectRoot,
    repoRoot: input && input.repoRoot,
  };
  const resolvedRoot = (input && input.targetRoot)
    ? input.targetRoot
    : adapter.resolveRoot(planningInput);
  const roots = new Set([resolvedRoot]);

  // Per the safety spec, also accept the canonical declared roots when present.
  // These DO NOT widen what apply.js permits when targetRoot is the temp dir;
  // they only matter if a caller has not set targetRoot AND has chosen a
  // non-default homeDir. In practice apply.js always sets targetRoot, so this
  // is belt-and-suspenders.
  if (scope === 'sandbox') {
    roots.add(path.resolve('./sandbox/home/.claude'));
  } else if (scope === 'project') {
    roots.add(path.resolve('./.claude'));
  } else if (scope === 'user') {
    roots.add(path.join(os.homedir(), '.claude'));
  }

  return [...roots];
}

function getClaudeManagedDestinationPath(adapter, sourceRelativePath, input) {
  const normalizedSourcePath = normalizeRelativePath(sourceRelativePath);
  const targetRoot = adapter.resolveRoot(input);

  if (normalizedSourcePath === 'rules') {
    return path.join(targetRoot, 'rules', CLAUDE_ECC_NAMESPACE);
  }

  if (normalizedSourcePath.startsWith('rules/')) {
    return path.join(
      targetRoot,
      'rules',
      CLAUDE_ECC_NAMESPACE,
      normalizedSourcePath.slice('rules/'.length)
    );
  }

  if (normalizedSourcePath === 'skills') {
    return path.join(targetRoot, 'skills', CLAUDE_ECC_NAMESPACE);
  }

  if (normalizedSourcePath.startsWith('skills/')) {
    return path.join(
      targetRoot,
      'skills',
      CLAUDE_ECC_NAMESPACE,
      normalizedSourcePath.slice('skills/'.length)
    );
  }

  return null;
}

module.exports = createInstallTargetAdapter({
  id: 'claude-home',
  target: 'claude',
  kind: 'home',
  rootSegments: ['.claude'],
  installStatePathSegments: ['ecc', 'install-state.json'],
  nativeRootRelativePath: '.claude-plugin',
  allowedRoots: buildClaudeAllowedRoots,
  planOperations(input, adapter) {
    const modules = Array.isArray(input.modules)
      ? input.modules
      : (input.module ? [input.module] : []);
    const planningInput = {
      repoRoot: input.repoRoot,
      projectRoot: input.projectRoot,
      homeDir: input.homeDir,
    };

    return modules.flatMap(module => {
      const paths = Array.isArray(module.paths) ? module.paths : [];
      return paths
        .filter(p => !isForeignPlatformPath(p, adapter.target))
        .map(sourceRelativePath => {
          const managedDestinationPath = getClaudeManagedDestinationPath(
            adapter,
            sourceRelativePath,
            planningInput
          );

          if (managedDestinationPath) {
            return createRemappedOperation(
              adapter,
              module.id,
              sourceRelativePath,
              managedDestinationPath,
              { strategy: 'preserve-relative-path' }
            );
          }

          return adapter.createScaffoldOperation(module.id, sourceRelativePath, planningInput);
        });
    });
  },
});
