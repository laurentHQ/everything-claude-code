# MVP Orchestrator Scope — 2026-05-17

**Plan:** `.claude/plan/17-05-2026-profile-based-installation-track-plan.md`
**Feature branch:** `feature/profiles-deploy-mvp` (already provisioned in this worktree)
**Status file:** create as `.claude/plan/17-05-2026-profile-based-installation-track-plan-status.md` per `track-orchestrator` skill

## In-scope tracks (MVP cut)

Implement ONLY these — defer T6, T7, T8 to a follow-up cycle:

1. **T1** — Profile Schema & Settings Extension
2. **T2** — Typed Operation Planner
3. **T3a** — Path-Safety Core
4. **T3b (minimal)** — Per-Adapter Allowed-Roots Declarations for **`claude-home.js` and `codex-home.js` only**. Defer `opencode-home.js` to v1 post-MVP.
5. **T4** — Sandbox Test Harness, scoped to:
   - The five general profiles × `{claude, codex}` only (drop `opencode` from snapshots)
   - `document-ai` × `{claude, codex}` only
   - `enterprise` × `{claude, codex}` only
6. **T5** — Lifecycle Over Typed Operations, scoped to:
   - `copy-file` and `merge-json` operation kinds only (do not implement `copy-tree`, `flatten-copy`, `render-template`, `merge-jsonc`, `mkdir`, `remove` lifecycle handlers)
   - State-schema migration: option (a) — bump `schemaVersion`, migrate-on-load via `scripts/lib/state-store/migrations.js`. **Do not** ship soft-warn fallback.
   - Audit-log writer (`scripts/lib/install/audit-log.js`) ships, but the runtime policy gate that enforces `allow_mcp:false` / `hook_profile:validation` is **deferred to T6** — declarative-only in MVP.

## Plan-review coordination notes (must thread into agent prompts)

1. **Apply.js sequencing.** T3a inserts `assertInsideAllowedRoot` immediately before any pre-write mutation at `scripts/lib/install/apply.js:120–146`. T2 then wraps the existing chain of `if (kind === ...)` branches with a typed dispatch table **in the same region**, preserving the call to `assertInsideAllowedRoot` and the existing `filterMcpConfig` call site (line 132/145). Sequencing: **T3a first, T2 wraps**. Both touch the same dispatch region.

2. **Deterministic operation ordering.** T2's `buildOperations(resolvedRequest, adapter)` must sort the emitted operations by `(moduleId, destination)` (lexicographic, ASCII) before returning. T4's snapshot tests rely on this. Document the sort contract in `schemas/install-plan.schema.json` (as a comment in the schema description or in a top-level note).

3. **T5 schema migration: lock to option (a).** When T5 adds the `operations[].kind` enum to `schemas/install-state.schema.json`, also bump `schemaVersion` and add a migration entry in `scripts/lib/state-store/migrations.js` that loads pre-bump state files unchanged (the existing `copy-file` / `merge-json` kinds are already in the new enum). Do not implement option (b) soft-warn.

4. **Declarative-only safety in MVP.** The profile-settings keys `allow_mcp`, `allowed_mcp_servers`, `block_global_install`, `hook_profile: validation` are **stored and validated** by T1/T5 but **not runtime-enforced** until T6. Tests must assert this gap explicitly (e.g., "MVP: `security` profile declares `allow_mcp:false` but installing an mcp module does not emit a `mcp-not-allowed` conflict — that lands in T6"). Add a `MVP-LIMITATIONS.md` note under `docs/` or at the top of `PROFILE-SAFETY-GUIDE.md` (the T8 doc — minimal stub OK in MVP). The pre-existing `ECC_DISABLED_MCPS` env-filter (already in `scripts/lib/install/apply.js:120,132,145`) continues to apply unchanged.

## Wave plan (proposed — orchestrator may adjust)

| Wave | Tracks | Notes |
|---|---|---|
| 1 | T1 | Schema PR (`schemas/install-profiles.schema.json`) merges before manifest PR (`manifests/install-profiles.json`) — both in this wave, sequential within. CI validator (`scripts/ci/validate-install-manifests.js`) extended in same wave. |
| 2 | T3a | Path-safety core alone — apply.js insertion lands first per coordination note 1. |
| 3 | T2 + T3b-min | Parallelizable on disjoint files. T2 wraps T3a's apply.js guard. T3b-min only touches `claude-home.js` and `codex-home.js`. |
| 4 | T5 | State schema bump + lifecycle.js branching + audit-log.js + apply.js backup wrap. |
| 5 | T4 | Fixtures + integration tests + snapshots. Lock snapshot key order per coordination note 2. |

## Out-of-scope (do not implement)

- T6 — Security Defaults & Policy Gates (deny-by-default, secret scanner)
- T7 — Promotion Lifecycle & CI Gating
- T8 — Operator UX & Docs **except** the MVP-limitations note required by coordination note 4
- T3b for `opencode-home.js`
- New operation kinds beyond `copy-file` / `merge-json` in T5 lifecycle handlers
- Snapshots for `opencode` target

## Verification gates per wave (per orchestrator skill)

- Tier T: `node tests/run-all.js` clean
- Tier W (wiring): trace `ecc plan` and `ecc install` CLI entry points — every new module reachable from at least one path
- Tier B (behavioral): for each wave that ships user-visible behavior, assert downstream state (file written, schema rejected, conflict emitted with correct `reason` + `severity`), not just return values
- Tier S (simplification): non-blocking — log into status file as tech-debt items

## Branch + commit rules

- Stay on `feature/profiles-deploy-mvp` for the entire MVP
- One commit per track per wave (or single combined wave commit if tightly coupled)
- Conventional commits: `feat(install):`, `feat(schema):`, `test(install):` etc.
- Do not merge to main; hand the branch back at completion

## When done

1. Update status file with all wave commit hashes
2. Print final summary: tracks landed, tests passing, tech-debt items deferred to v1
3. Stop. Do not open a PR — the outer sandbox lifecycle handles Phase 6 (PR publish) and Phase 7 (teardown).
