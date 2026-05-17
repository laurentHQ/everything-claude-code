# Profile-Based Installation MVP — Track Status

**Plan:** [`17-05-2026-profile-based-installation-track-plan.md`](17-05-2026-profile-based-installation-track-plan.md)
**MVP scope:** [`17-05-2026-MVP-orchestrator-scope.md`](17-05-2026-MVP-orchestrator-scope.md)
**Feature branch:** `feature/profiles-deploy-mvp` (pre-provisioned worktree — orchestrator does not create or merge it)
**Started:** 2026-05-17
**Verification command:** `node tests/run-all.js`

## In-scope tracks (MVP cut)

| Track | Subject | Notes |
|---|---|---|
| T1 | Profile Schema & Settings Extension | All 8 profiles validate with new schema |
| T2 | Typed Operation Planner | `copy-file` + `merge-json` only; deterministic sort by `(moduleId, destination)` |
| T3a | Path-Safety Core | `assertInsideAllowedRoot` integrated into `apply.js:120–146` dispatch region |
| T3b-min | Per-Adapter Allowed-Roots | `claude-home.js` + `codex-home.js` only — `opencode-home.js` deferred |
| T4 | Sandbox Test Harness | 5 general profiles × {claude, codex}; document-ai/enterprise × {claude, codex}; **no `opencode` snapshots** |
| T5 | Lifecycle Over Typed Operations | `copy-file` + `merge-json` lifecycle only; state-schema bump option (a) — migrate-on-load |

## Deferred (out of scope for MVP, tracked for v1)

- T3b for `opencode-home.js`
- T6 — Security Defaults & Policy Gates (runtime enforcement of `allow_mcp:false`, `block_global_install`, `hook_profile:validation`)
- T7 — Promotion Lifecycle & CI Gating
- T8 — Operator UX & Docs (except the MVP-limitations note required by coord note 4)
- T5 lifecycle handlers for `copy-tree`, `flatten-copy`, `render-template`, `merge-jsonc`, `mkdir`, `remove`
- Snapshots for `opencode` target

## Coordination notes (threaded into every agent prompt)

1. **Apply.js sequencing.** T3a inserts `assertInsideAllowedRoot` before the pre-write mutation at `scripts/lib/install/apply.js:120–146`. T2 wraps the dispatch chain in a typed table **in the same region**, preserving the call to `assertInsideAllowedRoot` and the existing `filterMcpConfig` call sites (lines 132/145). Order: **T3a first, T2 wraps**.
2. **Deterministic operation ordering.** T2's `buildOperations(resolvedRequest, adapter)` sorts by `(moduleId, destination)` lexicographic ASCII before returning. Documented in `schemas/install-plan.schema.json`.
3. **T5 schema migration: option (a) only.** Bump `schemaVersion` (`ecc.install.v1` → `ecc.install.v2`); migrate-on-load existing files. **Correction to original coord note:** the migration logic lands in `scripts/lib/install-state.js` (where `schemaVersion` is checked), NOT `scripts/lib/state-store/migrations.js` (that file is SQLite migrations for sessions/skills, unrelated).
4. **Declarative-only safety in MVP.** `allow_mcp`, `allowed_mcp_servers`, `block_global_install`, `hook_profile:validation` are stored + validated by T1/T5 but **not runtime-enforced** until T6. Tests assert this gap explicitly. `MVP-LIMITATIONS.md` (or top of `PROFILE-SAFETY-GUIDE.md`) records the gap. The pre-existing `ECC_DISABLED_MCPS` env-filter at `apply.js:120,132,145` continues to apply unchanged.

## Wave plan

| Wave | Tracks | Status | Commit(s) |
|---|---|---|---|
| 1 | T1 | **done** | `ddf803f1` |
| 2 | T3a | **done** | `d244024a` |
| 3 | T2 + T3b-min | **done** | `e187a96f` |
| 4 | T5 | **done** | (pending) |
| 5 | T4 | pending | — |

## Verification log

| Wave | Tier T (tests) | Tier W (wiring) | Tier B (behavioral) | Tier S (simplification) | Commit(s) |
|---|---|---|---|---|---|
| 1 | 2501/2501 ✓ | CI validator runs semantic checks; `getProfileSettings` exported; `resolveInstallPlan` surfaces `profileSettings`; `listInstallProfiles` passes through `settings`+`targets` | Schema rejects unknown `settings` keys; semantic checker emits `mcp-not-allowed`-style error msgs for each of the 3 rules; `getProfileSettings` clone-isolated | Two `cloneJsonValue` helpers now exist (`apply.js` + `install-manifests.js`); centralize in T2 | `ddf803f1` |
| 2 | 2514/2514 ✓ (+13) | `assertInsideAllowedRoot` called pre-write in `apply.js` for both per-op loop and resolved-claude-hooks final write; `getAllowedRoots` exported; adapter contract gains `allowedRoots(scope, input)` defaulting to `[]` (opt-in — no adapter declares yet, so no-op for existing flows) | symlink escape rejected, traversal `..` rejected, absolute-path escape rejected, empty allowedRoots is no-op, exact-match + nested + future-paths-with-missing-intermediates all pass; integration test in `tests/integration/path-safety.test.js` exercises apply.js | apply.js stayed minimal — 1 hoisted lookup + 2 assertion call sites; no factory helpers were touched (intentional; documented in `helpers.js` comment) | `d244024a` |
| 3 | 2537/2537 ✓ (+23) | `buildPlanDocument` consumed by `scripts/install-plan.js` when `--target` given; new dispatch table in `apply.js` handles `merge-json` + `copy-file` + `copy-path` (alias) and throws on unknown kinds; `claude-home` + `codex-home` now declare `allowedRoots` deriving from `input.targetRoot` (with `os`/`path` fallbacks for `sandbox`/`project`/`user` scope) | Real CLI `--profile enterprise --target claude --json` validates against `schemas/install-plan.schema.json`; `safety.mcpAllowed: true` reflects enterprise's `allow_mcp:true`; `safety.dryRunRequired: true` reflects `require_dry_run_first:true`; output is byte-identical on repeat invocations; conflicts emitted with `reason:"outside-allowed-root"` + `severity:"error"` when destinations escape | Discovery: the codebase actually emits a third operation kind `copy-path` from helpers.js. T2 added it to schema enum + dispatch table — flagged for v1 to reconcile with spec's preferred `copy-file` name. | `e187a96f` |
| 4 | 2561/2561 ✓ (+24) | `migrateInstallState` exported and called by `readInstallState`; `createInstallState` accepts `settings` + `backups` options; `createStatePreview` plumbs `profileSettings` from `createManifestInstallPlan`; `audit-log.js` exports `appendAuditEvent` / `maybeAppendAuditEvent` and is called from both `apply.js` and `install-lifecycle.js` uninstall path (try/catch wrapped); `copy-path` aliases `copy-file` in lifecycle via `isFileCopyKind` helper | v1 state file on disk migrates to v2 on `readInstallState` (verified manually); `audit.jsonl` written only when `settings.require_audit_log: true`, no write when false; audit entry contains timestamp + action + profileId; install-state schema enforces enum `kind` and optional `settings`/`backups` | Fixture v1 → v2 bumps in 3 existing tests (`install-state.test.js`, `install-apply.test.js`, `path-safety.test.js`) were applied directly rather than via `migrateInstallState` — pragmatic but a tech-debt item: a future test could lock the migration boundary by keeping a v1 fixture verbatim. | (pending) |
| 5 | — | — | — | — | — |

## Tech-debt items (deferred to v1, logged from Tier S)

- (Wave 1) Two `cloneJsonValue` helpers (one in `scripts/lib/install/apply.js`, one new in `scripts/lib/install-manifests.js`). T2 should consolidate when it creates `scripts/lib/install/plan-operations.js`.
- (Wave 3) Operation-kind naming: codebase emits `copy-path` from the adapter factory while apply.js/state-store call it `copy-file`. T2 added `copy-path` to both the install-plan schema enum and the dispatch table (aliased to `copy-file` handler) to bridge — v1 should pick one canonical name (recommendation in §0.5 item 1 of the track plan: keep `copy-file`, rename `copy-path` in helpers.js with a state-loader migration; or vice versa).
- (Wave 4) Test fixtures with hard-coded `ecc.install.v1` were bumped to `v2` rather than left as a regression-style migration test. A targeted future test should keep a v1 fixture verbatim and assert `readInstallState` migrates it — this would lock the migration boundary against future refactors.
- (Wave 4) Repair path is NOT wired to audit-log (only install + uninstall are). Pre-meditated MVP cut; v1 should add it when policy gate (T6) lands.

## Open follow-ups

_(none yet)_
