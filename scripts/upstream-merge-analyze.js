#!/usr/bin/env node
// Analyse a prospective merge of <remote>/<branch> (default: upstream/main)
// into one or more local branches. Reports divergence counts, conflicting
// files, which commits on each side touched them, and writes each conflicted
// file (with merge markers) plus a unified diff to a temp directory.
//
// Usage:
//   node scripts/upstream-merge-analyze.js [--fetch] [--remote upstream]
//                                          [--ref main] [--branch <name>...]
//                                          [--out <dir>] [--no-artifacts]
//                                          [--json]
//
// Exit code: 0 always (analysis tool). Use --json for machine consumption.

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

function git(args, { allowFail = false } = {}) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch (err) {
    if (allowFail) return null;
    throw err;
  }
}

// Like git() but tolerates non-zero exit (e.g. merge-tree returns 1 on conflict).
function gitCapture(args) {
  const res = spawnSync('git', args, { encoding: 'utf8' });
  return { stdout: res.stdout || '', stderr: res.stderr || '', status: res.status };
}

function parseArgs(argv) {
  const opts = {
    fetch: false,
    remote: 'upstream',
    ref: 'main',
    branches: [],
    json: false,
    artifacts: true,
    outDir: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--fetch') opts.fetch = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--no-artifacts') opts.artifacts = false;
    else if (a === '--out') opts.outDir = argv[++i];
    else if (a === '--remote') opts.remote = argv[++i];
    else if (a === '--ref') opts.ref = argv[++i];
    else if (a === '--branch') opts.branches.push(argv[++i]);
    else if (a === '-h' || a === '--help') {
      console.log(fs.readFileSync(__filename, 'utf8')
        .split('\n').slice(1, 15).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return opts;
}

function ensureRemoteExists(remote) {
  const list = git(['remote'], { allowFail: true }) || '';
  if (!list.split('\n').includes(remote)) {
    console.error(`Remote '${remote}' not configured. Add it with:`);
    console.error(`  git remote add ${remote} <url>`);
    process.exit(1);
  }
}

function divergence(localRef, upstreamRef) {
  // "behind\tahead" relative to upstreamRef
  const out = git(['rev-list', '--left-right', '--count', `${upstreamRef}...${localRef}`]);
  const [behind, ahead] = out.split(/\s+/).map(Number);
  return { behind, ahead };
}

function dryMerge(localRef, upstreamRef) {
  const base = git(['merge-base', localRef, upstreamRef], { allowFail: true });
  if (!base) return { clean: true, conflicts: [], reason: 'no common ancestor' };

  // --name-only emits: <tree-oid>\n<conflict-path>\n... then a blank line,
  // then any "Auto-merging"/"CONFLICT" info messages. Exit status is 1 on conflict.
  const { stdout, status } = gitCapture([
    'merge-tree', '--write-tree', '--name-only',
    `--merge-base=${base}`, localRef, upstreamRef,
  ]);
  if (status !== 0 && status !== 1) {
    return { clean: false, conflicts: [], base, error: `merge-tree exit ${status}` };
  }
  const lines = stdout.split('\n');
  const treeOid = lines[0];
  const conflicts = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === '') break; // blank line ends the conflict-path list
    conflicts.push(line);
  }
  return { clean: conflicts.length === 0, conflicts, base, treeOid };
}

// Pull a path out of the merged tree (contains conflict markers if it conflicted).
function readMergedBlob(treeOid, filePath) {
  const { stdout, status } = gitCapture(['cat-file', '-p', `${treeOid}:${filePath}`]);
  return status === 0 ? stdout : null;
}

// Unified diff between two refs for a single path.
function unifiedDiff(refA, refB, filePath) {
  const { stdout } = gitCapture(['diff', '--no-color', `${refA}...${refB}`, '--', filePath]);
  return stdout;
}

function safeBranchSlug(branch) {
  return branch.replace(/[^A-Za-z0-9._-]+/g, '_');
}

function writeArtifacts(outRoot, branchReport, upstreamRef) {
  if (!branchReport.conflicts || branchReport.conflicts.length === 0) return null;
  const branchDir = path.join(outRoot, safeBranchSlug(branchReport.branch));
  fs.mkdirSync(branchDir, { recursive: true });

  const indexLines = [
    `# Conflict artifacts: ${branchReport.branch} <- ${upstreamRef}`,
    `# merge-base tree: ${branchReport.mergeBase || '(unknown)'}`,
    `# merged tree:     ${branchReport.treeOid || '(unknown)'}`,
    '',
  ];

  for (const c of branchReport.conflicts) {
    const conflictPath = path.join(branchDir, c.file + '.conflict');
    const diffPath = path.join(branchDir, c.file + '.diff');
    fs.mkdirSync(path.dirname(conflictPath), { recursive: true });

    const merged = branchReport.treeOid ? readMergedBlob(branchReport.treeOid, c.file) : null;
    if (merged !== null) fs.writeFileSync(conflictPath, merged);

    const diff = unifiedDiff(branchReport.branch, upstreamRef, c.file);
    if (diff) fs.writeFileSync(diffPath, diff);

    c.artifacts = {
      conflict: merged !== null ? conflictPath : null,
      diff: diff ? diffPath : null,
    };
    indexLines.push(`- ${c.file}`);
    if (c.artifacts.conflict) indexLines.push(`    conflict: ${c.artifacts.conflict}`);
    if (c.artifacts.diff) indexLines.push(`    diff:     ${c.artifacts.diff}`);
  }

  const indexPath = path.join(branchDir, 'INDEX.md');
  fs.writeFileSync(indexPath, indexLines.join('\n') + '\n');
  return { dir: branchDir, index: indexPath };
}

function commitsTouching(file, includeRef, excludeRef) {
  const out = git([
    'log', '--oneline', `${includeRef}`, `^${excludeRef}`, '--', file,
  ], { allowFail: true });
  if (!out) return [];
  return out.split('\n').filter(Boolean);
}

function analyseBranch(branch, upstreamRef) {
  const exists = git(['rev-parse', '--verify', `${branch}^{commit}`], { allowFail: true });
  if (!exists) return { branch, error: 'branch not found' };

  const div = divergence(branch, upstreamRef);
  const merge = dryMerge(branch, upstreamRef);
  const conflicts = merge.conflicts.map(file => ({
    file,
    localCommits: commitsTouching(file, branch, upstreamRef),
    upstreamCommits: commitsTouching(file, upstreamRef, branch),
  }));
  return {
    branch,
    divergence: div,
    clean: merge.clean,
    conflicts,
    treeOid: merge.treeOid,
    mergeBase: merge.base,
  };
}

function renderText(report) {
  const { upstreamRef, branches } = report;
  const lines = [];
  lines.push(`Upstream ref: ${upstreamRef}`);
  lines.push('');
  for (const b of branches) {
    lines.push(`== ${b.branch} ==`);
    if (b.error) { lines.push(`  ERROR: ${b.error}`); lines.push(''); continue; }
    const { behind, ahead } = b.divergence;
    lines.push(`  divergence: ${behind} behind, ${ahead} ahead`);
    if (b.clean) {
      lines.push('  merge: CLEAN');
    } else {
      lines.push(`  merge: ${b.conflicts.length} conflict(s)`);
      for (const c of b.conflicts) {
        lines.push(`    - ${c.file}`);
        if (c.localCommits.length) {
          lines.push('      local commits:');
          c.localCommits.forEach(l => lines.push(`        ${l}`));
        }
        if (c.upstreamCommits.length) {
          lines.push('      upstream commits:');
          c.upstreamCommits.forEach(l => lines.push(`        ${l}`));
        }
        if (c.artifacts) {
          if (c.artifacts.conflict) lines.push(`      conflict file: ${c.artifacts.conflict}`);
          if (c.artifacts.diff) lines.push(`      diff file:     ${c.artifacts.diff}`);
        }
      }
      if (b.artifactsDir) lines.push(`  artifacts dir: ${b.artifactsDir}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  ensureRemoteExists(opts.remote);

  if (opts.fetch) {
    if (!opts.json) console.error(`Fetching ${opts.remote}...`);
    execFileSync('git', ['fetch', opts.remote], { stdio: opts.json ? 'ignore' : 'inherit' });
  }

  const upstreamRef = `${opts.remote}/${opts.ref}`;
  const upstreamExists = git(['rev-parse', '--verify', `${upstreamRef}^{commit}`], { allowFail: true });
  if (!upstreamExists) {
    console.error(`Ref '${upstreamRef}' not found. Run with --fetch or check --remote/--ref.`);
    process.exit(1);
  }

  if (opts.branches.length === 0) {
    const current = git(['rev-parse', '--abbrev-ref', 'HEAD']);
    opts.branches = current === 'main' ? ['main'] : [current, 'main'];
  }

  const report = {
    upstreamRef,
    branches: opts.branches.map(b => analyseBranch(b, upstreamRef)),
  };

  if (opts.artifacts) {
    const branchesWithConflicts = report.branches.filter(b => !b.clean && b.conflicts && b.conflicts.length > 0);
    if (branchesWithConflicts.length > 0) {
      const outRoot = opts.outDir
        || fs.mkdtempSync(path.join(os.tmpdir(), 'upstream-merge-analyze-'));
      fs.mkdirSync(outRoot, { recursive: true });
      report.outDir = outRoot;
      for (const b of branchesWithConflicts) {
        const written = writeArtifacts(outRoot, b, upstreamRef);
        if (written) b.artifactsDir = written.dir;
      }
    }
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    process.stdout.write(renderText(report));
  }
}

main();
