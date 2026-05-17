const path = require('path');
const os = require('os');

const { createInstallTargetAdapter } = require('./helpers');

function buildOpencodeAllowedRoots(scope, input, adapter) {
  const planningInput = {
    homeDir: input && input.homeDir,
    projectRoot: input && input.projectRoot,
    repoRoot: input && input.repoRoot,
  };
  const resolvedRoot = (input && input.targetRoot)
    ? input.targetRoot
    : adapter.resolveRoot(planningInput);
  const roots = new Set([resolvedRoot]);

  // Defensive: scope-specific canonical roots.
  // opencode has NO project-scope mirror (no ./.opencode); user/sandbox only.
  if (scope === 'sandbox') {
    roots.add(path.resolve('./sandbox/home/.opencode'));
  } else if (scope === 'user') {
    roots.add(path.join(os.homedir(), '.opencode'));
  }

  return [...roots];
}

module.exports = createInstallTargetAdapter({
  id: 'opencode-home',
  target: 'opencode',
  kind: 'home',
  rootSegments: ['.opencode'],
  installStatePathSegments: ['ecc-install-state.json'],
  nativeRootRelativePath: '.opencode',
  allowedRoots: buildOpencodeAllowedRoots,
});
