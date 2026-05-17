'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Resolve a path to its canonical absolute form, following symlinks where they
 * exist. Because install destinations are usually pre-write (the file does not
 * exist yet), this walks up the path until it finds an existing ancestor,
 * realpath's that ancestor, then re-attaches the missing tail.
 *
 * @param {string} p
 * @returns {string} canonical absolute path
 */
function resolveRealPath(p) {
  if (typeof p !== 'string' || p.length === 0) {
    throw new TypeError('resolveRealPath: path must be a non-empty string');
  }

  const absolute = path.resolve(p);
  const realpath = (fs.realpathSync && fs.realpathSync.native) || fs.realpathSync;

  // Fast path: the full path exists — realpath it directly.
  if (fs.existsSync(absolute)) {
    try {
      return realpath(absolute);
    } catch (_err) {
      // Fall through to the segment walk if realpath fails unexpectedly.
    }
  }

  // Slow path: walk up until we find an existing ancestor, realpath it, then
  // re-attach the missing suffix.
  const parsed = path.parse(absolute);
  const root = parsed.root;
  const segments = absolute.slice(root.length).split(path.sep).filter(Boolean);

  // Try progressively shorter prefixes (longest first).
  for (let i = segments.length; i >= 0; i -= 1) {
    const prefix = root + segments.slice(0, i).join(path.sep);
    const candidate = prefix.length > 0 ? prefix : root;
    if (fs.existsSync(candidate)) {
      let resolvedPrefix;
      try {
        resolvedPrefix = realpath(candidate);
      } catch (_err) {
        // If realpath fails, keep the un-resolved prefix; we still want a
        // canonical absolute path even if a symlink along the way is broken.
        resolvedPrefix = candidate;
      }
      const remainder = segments.slice(i);
      if (remainder.length === 0) {
        return resolvedPrefix;
      }
      return path.join(resolvedPrefix, ...remainder);
    }
  }

  // Should never get here (root always exists on posix), but be defensive.
  return absolute;
}

/**
 * Test whether `destination` is inside one of `allowedRoots`, using canonical
 * (realpath-resolved) comparison on segment boundaries.
 *
 * If `allowedRoots` is null, undefined, or empty, this is a no-op (opt-in
 * semantics): the function returns true. This is what gives adapters a
 * zero-behavior-change default until they explicitly declare roots.
 *
 * @param {string} destination
 * @param {string[]|null|undefined} allowedRoots
 * @returns {boolean}
 */
function isInsideAllowedRoot(destination, allowedRoots) {
  if (!Array.isArray(allowedRoots) || allowedRoots.length === 0) {
    return true;
  }

  const resolvedDest = resolveRealPath(destination);

  for (const root of allowedRoots) {
    if (typeof root !== 'string' || root.length === 0) {
      continue;
    }
    const resolvedRoot = resolveRealPath(root);

    // Exact match counts as inside.
    if (resolvedDest === resolvedRoot) {
      return true;
    }

    // Canonical "is dest under root?" check via path.relative.
    // If the relative path starts with '..' or is absolute, dest escapes root.
    const relative = path.relative(resolvedRoot, resolvedDest);
    if (!relative.startsWith('..') && !path.isAbsolute(relative) && relative.length > 0) {
      return true;
    }
  }

  return false;
}

/**
 * Throwing form of {@link isInsideAllowedRoot}.
 *
 * On failure the thrown Error's message contains the exact substring
 * `reason: outside-allowed-root` — this is a contract consumed by the
 * conflicts[] emitter in T2. Do not change the wording.
 *
 * @param {string} destination
 * @param {string[]|null|undefined} allowedRoots
 */
function assertInsideAllowedRoot(destination, allowedRoots) {
  if (!Array.isArray(allowedRoots) || allowedRoots.length === 0) {
    return;
  }

  if (!isInsideAllowedRoot(destination, allowedRoots)) {
    throw new Error(
      `Destination escapes allowed roots: ${destination} (reason: outside-allowed-root)`
    );
  }
}

module.exports = {
  assertInsideAllowedRoot,
  isInsideAllowedRoot,
  resolveRealPath,
};
