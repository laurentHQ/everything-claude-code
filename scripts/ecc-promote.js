#!/usr/bin/env node
'use strict';

const path = require('path');
const { applyTransition } = require('./lib/install/lifecycle-transitions');

const DEFAULT_MANIFEST_PATH = path.join(__dirname, '..', 'manifests', 'install-profiles.json');

function showHelp() {
  console.log(`
Transition a profile lifecycle state.

Usage:
  node scripts/ecc-promote.js <profileId> --to <draft|candidate|promoted> [--force] [--dry-run] [--manifest <path>]

Options:
  --to <state>        Target lifecycle state (required)
  --force             Allow backwards or skip-ahead transitions
  --dry-run           Validate without writing the manifest
  --manifest <path>   Override manifest path (defaults to manifests/install-profiles.json)
  --help              Show this help
`);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    return { help: true };
  }
  const profileId = args[0];
  let toState = null;
  let force = false;
  let dryRun = false;
  let manifestPath = null;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--to') { toState = args[++i]; }
    else if (args[i] === '--force') { force = true; }
    else if (args[i] === '--dry-run') { dryRun = true; }
    else if (args[i] === '--manifest') { manifestPath = args[++i]; }
    else throw new Error(`Unknown argument: ${args[i]}`);
  }
  return { help: false, profileId, toState, force, dryRun, manifestPath };
}

function main() {
  let parsed;
  try { parsed = parseArgs(process.argv); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exit(2); }
  if (parsed.help) { showHelp(); process.exit(0); }
  if (!parsed.toState) { process.stderr.write('--to <state> is required\n'); process.exit(2); }

  const manifestPath = parsed.manifestPath || DEFAULT_MANIFEST_PATH;

  try {
    const result = applyTransition(manifestPath, parsed.profileId, parsed.toState, {
      force: parsed.force,
      dryRun: parsed.dryRun,
    });
    if (result.applied) {
      console.log(`promoted ${parsed.profileId}: ${result.from} -> ${result.to} (${result.reason})`);
    } else {
      console.log(`dry-run: ${parsed.profileId} ${result.from} -> ${result.to} (${result.reason})`);
    }
    process.exit(0);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) main();
module.exports = { parseArgs };
