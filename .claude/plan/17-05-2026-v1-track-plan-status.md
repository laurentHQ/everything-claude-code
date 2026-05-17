# V1 Profile-Based Installation — Track Status

**Plan:** [`17-05-2026-v1-track-plan.md`](17-05-2026-v1-track-plan.md)
**Feature branch:** `feature/profiles-deploy-v1` (pre-provisioned; do not branch from main again)
**Started:** 2026-05-17
**Baseline:** 2593/2593 passing
**Verification command:** `node tests/run-all.js`

## Wave plan

| Wave | Tracks | Status | Commit(s) |
|---|---|---|---|
| 0 | W0 — PR #2 deferred-patch (I3, I5, I6, I7, I8, I10) | **done** | (pending) |
| 1 | T2-rest then T3b-rest *(sequential within wave)* | **done** | (pending) |
| 2 | T6 — Security Defaults & Policy Gates | pending | — |
| 3 | T7 — Promotion Lifecycle & CI Gating | pending | — |
| 4 | T8 — Operator UX & Docs | pending | — |

## Locked decisions (from plan-review)

1. Render-template engine: **Mustache** with `allowedKeys` context restriction.
2. CI workflow scope: **GitHub Actions** (existing `.github/workflows/`).
3. Fallback validator: **drop** in W0/I10; `ajv` becomes hard dep.
4. T7 lifecycle storage: **in-place manifest edit** via new `scripts/lib/json-format.js`.
5. `MVP-LIMITATIONS.md`: **rename** to `docs/PROFILE-LIMITATIONS.md` with anti-rot test.
6. Coord-note typo: **closed** without retroactive edit.

## Plan-review BLOCK resolutions (all four threaded into Wave specs)

- **BLOCK #1** (T6): `assertNoBlockingConflicts(planDocument)` in policy.js, wired into `scripts/install-apply.js` AND `scripts/lib/install-executor.js:applyInstallPlan` so `severity:"error"` conflicts throw before any write. New acceptance test in T6.
- **BLOCK #2** (T6): `evaluatePolicy` input contract — `resolvedRequest.selectedModules` MUST be full objects (install-manifests.js:584), not state-shape strings. Runtime assertion guards the boundary.
- **BLOCK #3** (W0): I5/I6 caller propagation enumerated — `analyzeRecord`, `executeRepairOperation`, doctor JSON report, and affected tests.
- **BLOCK #4** (T7): Lifecycle storage in-place manifest edit via `scripts/lib/json-format.js`.

## Verification log

| Wave | Tier T | Tier W (wiring) | Tier B (behavioral) | Tier S (simplification) | Commit(s) |
|---|---|---|---|---|---|
| 0 | targeted 11 suites green (+10 new tests; total 2603/2603 unchanged by spot-check) | I3 ajv validator imported in plan-operations.js + install-plan.js; I10 shared schemas `$ref`'d from profiles/state/plan; I5/I6 new statuses surface in `inspectManagedOperation` callers (`analyzeRecord`, `executeRepairOperation`); `createFallbackValidator` deleted, `ajv` is now hard dep | parse-error / permission-error / drifted distinguished and tested separately; `apply` throws with kind name on unknown dispatch; `audit-on` round-trip retains `audit.jsonl`; `audit-off` round-trip leaves zero residuals | Agent had to add 2 minor collateral edits (CI validator pre-registers shared schemas; `install-plan.schema.json` $id dropped so $ref resolves) — both documented; absolute `$id` removal is a tech-debt item if we ever publish schemas externally | (pending) |
| 1 | targeted 18 suites green (+18 new tests across 6 kinds + opencode); 19 snapshot files all pass | apply.js DISPATCH covers all 9 kinds (merge-json, merge-jsonc, copy-file, copy-path, copy-tree, flatten-copy, render-template, mkdir, remove); install-lifecycle.js extended via isFileCopyKind for copy-tree/flatten-copy + new mkdir/merge-jsonc branches; install-executor.js's addRecursiveCopyOperations / addMatchingRuleOperations now emit correct kind labels; opencode-home declares allowedRoots (mirroring claude/codex pattern) | render-template enforces context-key presence + allowedKeys restriction (template-variable leakage guard); merge-jsonc strips // and /* */ comments before merge; mkdir is idempotent + uninstall removes only if empty; remove is idempotent on missing; opencode round-trip restores baseline; 5 new opencode snapshots match deterministically; existing 14 snapshots unchanged (claude/codex/opencode use createRemappedOperation which kept copy-path, so T2-rest's relabel of addRecursiveCopyOperations doesn't reach them — out-of-MVP adapters benefit) | Agent ran in 11min vs Wave 0's 36min — pre-located touchpoints + parallel-dispatch worked. T2-rest agent removed 3 lifecycle-test sentinel-via-mkdir assertions that became unreachable when mkdir became first-class (documented; dispatch defenses still exercised by apply-unknown-kind.test.js) | (pending) |
| 2 | — | — | — | — | — |
| 3 | — | — | — | — | — |
| 4 | — | — | — | — | — |

## Tech-debt items (logged from Tier S, non-blocking)

_(none yet)_
