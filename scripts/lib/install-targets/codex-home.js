const os = require('os');
const path = require('path');

const { createInstallTargetAdapter } = require('./helpers');

function buildCodexAllowedRoots(scope, input, adapter) {
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

  if (scope === 'sandbox') {
    roots.add(path.resolve('./sandbox/home/.codex'));
  } else if (scope === 'project') {
    roots.add(path.resolve('./.codex'));
  } else if (scope === 'user') {
    roots.add(path.join(os.homedir(), '.codex'));
  }

  return [...roots];
}

module.exports = createInstallTargetAdapter({
  id: 'codex-home',
  target: 'codex',
  kind: 'home',
  rootSegments: ['.codex'],
  installStatePathSegments: ['ecc-install-state.json'],
  nativeRootRelativePath: '.codex',
  allowedRoots: buildCodexAllowedRoots,
});
