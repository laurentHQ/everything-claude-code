# PR #2 Review — `feature/profiles-deploy-mvp`

**PR:** https://github.com/laurentHQ/everything-claude-code/pull/2
**Range reviewed:** `ddf803f1..94fb534e` (6 commits — T1, T3a, T2+T3b-min, T5, T4, status backfill)
**Reviewed:** 2026-05-17
**Method:** 5 parallel specialized agents from `pr-review-toolkit` — code-reviewer, pr-test-analyzer, silent-failure-hunter, type-design-analyzer, comment-analyzer
**Test baseline:** 2588/2588 passing

---

## Verdict

**Recommend merge after addressing the single critical issue (C1) plus the highest-leverage important items.** All other findings are non-blocking and can land in a follow-up.

---

## Critical (block merge)

### C1 — Audit-log writes bypass `assertInsideAllowedRoot`
**Source:** code-reviewer (confidence 85), corroborated by silent-failure-hunter
**Files:** `scripts/lib/install/apply.js:219–235`, `scripts/lib/install/audit-log.js:14–25`

Every other write in `apply.js` is gated by `assertInsideAllowedRoot`; the audit-log `fs.appendFileSync` is not. For `claude-home`/`codex-home` the audit path lands inside `targetRoot`, so behavior is benign today. But `plan.auditLogPath` is already an exposed override, and a sandbox `stateDir` could be set outside any allowed root — the safety contract would silently leak.

**Fix:** Either gate the audit-log destination through `assertInsideAllowedRoot` against `plan.adapter.allowedRoots(...)`, OR document the bypass explicitly in `path-safety.js` and require all audit-log destinations to be derived from `targetRoot`/`stateDir` that the adapter has already vetted.

---

## Important (should fix soon)

### I1 — Audit-log failure-path is not tested
**Source:** pr-test-analyzer (criticality 9)
**Contract:** "audit-log failures never block install."
**Gap:** No test injects an EACCES/EISDIR/etc. on `audit.jsonl` and asserts `applyInstallPlan` still returns `{ applied: true }` + state is written + `[audit-log]` appears on stderr. A future refactor that reorders `writeInstallState` after the audit append (or removes the try/catch) would silently regress.

### I2 — `migrateInstallState` returns unknown-version states silently
**Source:** silent-failure-hunter (C2)
**File:** `scripts/lib/install-state.js:360–377`

The function comments admit "leave as-is so the validator surfaces it." But:
- An external caller using `migrateInstallState` standalone receives an un-migrated object with no warning.
- A future `ecc.install.v3` produces a misleading "must equal ecc.install.v2" error instead of a forward-compat hint.

**Fix:** Emit `[install-state] unknown schemaVersion ...` to stderr (minimum), or throw `Unsupported install-state schemaVersion: <x> (known: v1, v2)`.

### I3 — `install-plan.schema.json` is documentation-only at runtime
**Source:** type-design-analyzer (critical in that report; demoted to important here because callers do validate in tests)

AJV compiles install-state and install-profiles schemas at runtime; install-plan is validated only in tests. `buildPlanDocument` constructs the document by hand without validating its own output. T6's policy gate (and any future plan consumer) has no enforced contract.

**Fix:** Add AJV validator inside `buildPlanDocument` (or at the `--json` boundary in `scripts/install-plan.js`). Keep behind a flag if startup cost matters.

### I4 — Stale references in `docs/MVP-LIMITATIONS.md` and status file
**Source:** comment-analyzer (critical in that report)
**Files:** `docs/MVP-LIMITATIONS.md:13`, `docs/MVP-LIMITATIONS.md:28–29`, `.claude/plan/17-05-2026-profile-based-installation-track-plan-status.md:34`

- `apply.js:120,132,145` line refs are wrong after T2's refactor. New positions: `apply.js:144,157,184`. **Better:** drop line numbers entirely — they will rot again.
- MVP-LIMITATIONS bottom paragraph claims T2/T3/T5 are future work; they all shipped on this branch. Rewrite as "Runtime enforcement of declarative settings lands in T6/T7/T8 (deferred to v1)."

### I5 — `inspectManagedOperation` for `merge-json` lumps parse errors with content drift
**Source:** silent-failure-hunter (C4)
**File:** `scripts/lib/install-lifecycle.js:596–611`

`catch (_error) { return { status: 'drifted' } }`. A corrupted JSON file → user is told "differs from source" → repair re-merges from `{}`, silently discarding their edits.

**Fix:** Distinguish `parse-error`, `permission-error`, `drifted`; surface parser message on stderr.

### I6 — `areFilesEqual` swallows EACCES/EMFILE/ELOOP as "drifted"
**Source:** silent-failure-hunter (C3)
**File:** `scripts/lib/install-lifecycle.js:68–80`

Same shape as I5. A permission denial gets reported as a content drift, which then triggers an unintended `repair` overwrite.

**Fix:** Only return `false` for genuine content-differences; explicit `ENOENT` handling, rethrow or log on anything else.

### I7 — Unknown-kind dispatch rejection untested at integration boundary
**Source:** pr-test-analyzer (criticality 8)
**File:** test gap — `apply.js:172–180` throws but no test passes `kind: 'symlink'` through `applyInstallPlan`.

A regression where the dispatch silently no-ops would not be caught.

### I8 — Round-trip test filters `ecc/audit.jsonl` from residuals
**Source:** pr-test-analyzer (criticality 7)
**File:** `tests/integration/round-trip.test.js:131–138`

`minimal` profile has `require_audit_log` unset → file should NOT exist. The filter masks the bug "audit-log is accidentally written without the flag."

**Fix:** Replace filter with `assert.deepStrictEqual(filesAfterUninstall, [])` for audit-off case; or split into audit-on + audit-off tests.

### I9 — `migrateInstallState` test doesn't pin added v2 fields
**Source:** pr-test-analyzer (criticality 8)
**File:** `tests/lib/install-state-migration.test.js:85–101`

Only asserts `schemaVersion` and pre-existing v1 fields. If migration is supposed to inject defaults for `settings`/`backups`, the test would pass even if the migration forgot them.

### I10 — Cross-schema drift on `settings` block
**Source:** type-design-analyzer (critical there)

The 9-key `settings` block is duplicated verbatim across `install-profiles.schema.json` and `install-state.schema.json`. Any future enum change must land in two places.

**Fix:** Extract to `schemas/install-settings.schema.json` and `$ref` from both. Same problem for `operations[].kind` enum (duplicated in install-plan and install-state).

---

## Suggestions (nice to have)

| ID | Source | Topic | Action |
|---|---|---|---|
| S1 | silent-failure | `path-safety.js` realpath swallowed errors | Log `[path-safety] realpath failed for <p>: <code>` |
| S2 | silent-failure | `claude-home`/`codex-home` cryptic TypeError on missing adapter | Guard with explicit `if (!adapter \|\| !adapter.resolveRoot) throw ...` |
| S3 | silent-failure | `buildPlanDocument` with `adapter:null` claims `allDestinationsInsideAllowedRoots:true` | Set to `null` + emit `warnings[]` entry when adapter is missing |
| S4 | test-analyzer | Snapshot determinism test should call `buildSnapshot` twice in same run | Add byte-equality assertion |
| S5 | test-analyzer | Symlink-escape test only covers leaf symlinks | Add ancestor-symlink test for classic TOCTOU vector |
| S6 | type-design | Plan-level `schemaVersion` missing | Add `schemaVersion` const to install-plan.schema.json so it can evolve |
| S7 | type-design | Express semantic invariants in JSON Schema | Use `if/then/dependentSchemas` for `allow_mcp` ↔ `allowed_mcp_servers` |
| S8 | comment | "pre-T2 conditional chain" historical framing in `apply.js:125` | Drop historical references; the code stands on its own |
| S9 | comment | "T4's snapshot tests" reference in `plan-operations.js:8` | Rewrite as "snapshot tests in `tests/snapshots/**`" |
| S10 | code-reviewer | `install-plan.js:280–281` silent adapter-resolution catch | Remove the catch — `resolveInstallPlan` already validates |
| S11 | code-reviewer | Coord-note #3 wording references wrong migrations file | Update orchestrator-scope note to match reality (lives in `install-state.js`, not `state-store/migrations.js`) |

---

## Strengths (positive observations)

- **Coord notes honored end-to-end.** Apply.js sequencing (T3a before T2 wrap), deterministic sort, state-schema option (a), declarative-only safety all verified in code.
- **`copy-path` ↔ `copy-file` aliasing is internally consistent.** Planner emits `copy-path`, apply DISPATCH routes both kinds, lifecycle's `isFileCopyKind` covers all 5 call sites (hydrate, inspect, uninstall, repair, shouldRepair). No divergence found.
- **MVP-vs-T6 gap is intentionally pinned in tests** (`profile-conflict.test.js:102–132`). Will fail loudly when T6 lands — exactly the right design.
- **Snapshot comparison is byte-level on the stringified text**, preserving the determinism contract correctly.
- **Path-safety partial-write ordering test** verifies downstream filesystem state, not just throw — exemplary behavioral coverage.
- **Three-way registry cross-validation** (`install-targets.test.js:724–766`): schema enum ↔ adapter registry ↔ `SUPPORTED_INSTALL_TARGETS`.
- **All 6 commits follow conventional-commit format.** `feat(install):` / `test(install):` / `docs(plan):`.
- **CommonJS-only and no `var`** confirmed throughout new code.
- **Backward-compat for v1 install-state** verified via dedicated migration test.

---

## Recommended Action Plan

1. **Before merge — fix C1.** Either gate audit-log through `assertInsideAllowedRoot` or document the deliberate bypass.
2. **Follow-up PR (next session) — address I1, I2, I4, I9.** Highest-leverage durability + accuracy fixes.
3. **v1 cycle (when T6 lands)** — address I3, I5, I6, I7, I8, I10 alongside the policy-gate work. These compound nicely with T6.
4. **Tech-debt log** — add S1–S11 to the status file's tech-debt section; no need to fix immediately.

---

## Type-design ratings (from type-design-analyzer)

| Dimension | Score | Rationale |
|---|---|---|
| Encapsulation | 3/5 | `additionalProperties:true` on operations/conflicts + missing plan-level `schemaVersion` leak forward-compat as a permanent escape hatch |
| Invariant expression | 2/5 | Interesting invariants (allow_mcp ↔ allowed_mcp_servers, block_global_install ↔ scope, dry-run gating) live only in CI JS, not in schemas |
| Usefulness | 4/5 | Plan document is a useful boundary type: deterministic sort, explicit `safety`, structured `conflicts` |
| Enforcement | 2/5 | install-plan is validated only in tests; production emissions are unchecked |

---

## Per-agent counts

| Agent | Critical | Important | Suggestions |
|---|---|---|---|
| code-reviewer | 0 | 2 | 2 |
| pr-test-analyzer | 3 | 5 | 3 |
| silent-failure-hunter | 5 | 8 | 4 |
| type-design-analyzer | 4 | 4 | 4 |
| comment-analyzer | 2 | 5 | 3 |
| **De-duplicated total in this report** | **1** | **10** | **11** |

(Several findings overlapped across agents — most notably the audit-log error-handling/contract concerns were flagged by 3 of the 5 agents and consolidated into C1+I1.)
