/**
 * Snapshot tests for install-plan documents.
 *
 * For every (profile, target) entry in MATRIX, regenerate the canonical
 * install-plan JSON document (via the same code path as
 * scripts/install-plan.js --json) and compare it byte-for-byte against
 * the committed snapshot under tests/snapshots/.
 *
 * If a snapshot diverges:
 *   - Inspect the diff hint printed to stderr.
 *   - If the change is intentional, regenerate snapshots via:
 *       node tests/integration/lib/generate-snapshots.js
 *     then review and commit.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { buildSnapshot, snapshotPath, MATRIX } = require('./lib/generate-snapshots');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function runTests() {
  console.log('\n=== Testing install-plan snapshots (profile x target) ===\n');

  let passed = 0;
  let failed = 0;

  for (const [profileId, target] of MATRIX) {
    const name = `${profileId} x ${target} matches committed snapshot`;
    if (test(name, () => {
      const snap = buildSnapshot(profileId, target);
      const actualText = JSON.stringify(snap, null, 2) + '\n';
      const snapPath = snapshotPath(profileId, target);
      assert.ok(
        fs.existsSync(snapPath),
        `Missing snapshot file at ${snapPath}. Run: node tests/integration/lib/generate-snapshots.js`
      );
      const expectedText = fs.readFileSync(snapPath, 'utf8');
      if (actualText !== expectedText) {
        process.stderr.write(
          `Snapshot diff for ${profileId}/${target}: run \`node tests/integration/lib/generate-snapshots.js\` ` +
          'to regenerate, then review the diff before committing.\n'
        );
        // Surface a small diff hint by showing first divergence point.
        const aLines = actualText.split('\n');
        const eLines = expectedText.split('\n');
        const maxLen = Math.min(aLines.length, eLines.length);
        for (let i = 0; i < maxLen; i++) {
          if (aLines[i] !== eLines[i]) {
            process.stderr.write(`  first diff line ${i + 1}:\n`);
            process.stderr.write(`    expected: ${eLines[i]}\n`);
            process.stderr.write(`    actual  : ${aLines[i]}\n`);
            break;
          }
        }
        throw new Error(
          `Snapshot mismatch at ${path.relative(process.cwd(), snapPath)}.`
        );
      }
    })) passed++; else failed++;
  }

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
