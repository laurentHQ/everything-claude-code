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
| 1 | T1 | pending | — |
| 2 | T3a | pending | — |
| 3 | T2 + T3b-min | pending | — |
| 4 | T5 | pending | — |
| 5 | T4 | pending | — |

## Verification log

| Wave | Tier T (tests) | Tier W (wiring) | Tier B (behavioral) | Tier S (simplification) | Commit(s) |
|---|---|---|---|---|---|
| 1 | — | — | — | — | — |
| 2 | — | — | — | — | — |
| 3 | — | — | — | — | — |
| 4 | — | — | — | — | — |
| 5 | — | — | — | — | — |

## Tech-debt items (deferred to v1, logged from Tier S)

_(none yet)_

## Open follow-ups

_(none yet)_
