# ECC Profile-Based Deployment — V1 Track Plan

**Plan date:** 2026-05-17
**Builds on:** [`17-05-2026-profile-based-installation-track-plan.md`](17-05-2026-profile-based-installation-track-plan.md) (the full plan) and its [MVP scope cut](17-05-2026-MVP-orchestrator-scope.md). The MVP shipped via PR #2 (merge commit `a99b38bf`); see [`pr-2-review.md`](../reviews/pr-2-review.md) for the multi-agent review that drives Wave 0 of this plan.
**Goal:** Land the post-MVP v1 cut: pre-flight cleanup of PR #2's deferred review items, then full T6 (policy gates) + T7 (promotion lifecycle) + T8 (operator docs), plus the deferred operation kinds and the opencode adapter.

## Carryover from MVP

The MVP shipped **declarative-only** safety. Settings are stored + schema-validated + surfaced via `getProfileSettings()` / `resolveInstallPlan(...).profileSettings`, but no runtime gate refuses an install when settings say "no." That gap is the central deliverable for V1 (T6 below).

Concrete MVP artifacts to know about:
- 8 profiles in `manifests/install-profiles.json` (5 general + `document-ai` + `enterprise` + `full`).
- 14 snapshots in `tests/snapshots/{profile}/install-plan.{target}.json` (no `opencode` yet).
- `tests/integration/profile-conflict.test.js` **explicitly asserts the V1 gap is open** — when T6 ships, those assertions flip from "no `mcp-not-allowed` conflict emitted" to "exactly one `mcp-not-allowed` conflict with `severity: error`." These tests are tripwires designed to fail loudly during T6.
- `docs/MVP-LIMITATIONS.md` documents the same gap operator-side.
- 2593/2593 tests green on `main` as of `a99b38bf`.

---

## V1 In-Scope Targets

Same three harness adapters as MVP (`claude`, `codex`, `opencode`), but V1 promotes `opencode` from "deferred" to "snapshot-locked + lifecycle-tested" alongside `claude` and `codex`. The other six adapters (`cursor`, `gemini`, `qwen`, `antigravity`, `codebuddy`, `joycode`) remain out of scope — those move into a `v1.1: secondary-harness rollout` plan.

---

## Tracks

### Track W0 — Review-Deferred Patch *(PR #2 review carryover)*

The MVP's PR #2 review surfaced ten findings. Five (C1 + I1/I2/I4/I9) were patched on the branch before merge (commit `7710e0e5`). The remaining six are landed here as the first track of V1.

| ID | Source | What | File(s) |
|---|---|---|---|
| **I3** | type-design / code-review | `buildPlanDocument` doesn't validate its own output against `schemas/install-plan.schema.json` at runtime — schema is only enforced in tests. T6 will consume the plan document, so the contract needs an AJV gate. | `scripts/lib/install/plan-operations.js` (add ajv compile + validate before return); `scripts/install-plan.js` (validate at `--json` boundary) |
| **I5** | silent-failure | `inspectManagedOperation` for `merge-json` collapses parse errors + permission errors + content drift into one `drifted` status, which then triggers destructive repair-from-`{}`. | `scripts/lib/install-lifecycle.js:596–611` — distinguish `parse-error`, `permission-error`, `drifted` |
| **I6** | silent-failure | `areFilesEqual` swallows EACCES/EMFILE/ELOOP/EBUSY as "different content," masking real I/O failures. | `scripts/lib/install-lifecycle.js:68–80` — explicit ENOENT handling; rethrow other codes (or log + propagate) |
| **I7** | test-analyzer | The dispatch table in `apply.js` throws on unknown `kind`, but no integration test exercises that path with a synthetic plan. A regression to silent no-op would not be caught. | New test in `tests/integration/apply-unknown-kind.test.js` |
| **I8** | test-analyzer | `tests/integration/round-trip.test.js` filters `ecc/audit.jsonl` from residual-file comparison, which masks "audit-log accidentally written without `require_audit_log:true`." | Split into two cases: `audit-on` round-trip (asserts `audit.jsonl` lifecycle) + `audit-off` round-trip (asserts no `audit.jsonl` was ever created) |
| **I10** | type-design | Settings block + `operations[].kind` enum are duplicated across `install-profiles.schema.json` and `install-state.schema.json` / `install-plan.schema.json`. Drift risk. | Extract `schemas/install-settings.schema.json` and `schemas/install-operations.schema.json` with `$ref` from the consumers |

**Why first:** Wave 0 lands the foundations that subsequent tracks consume — I3 enforces the install-plan contract that T6's policy gate emits into; I10's shared schemas let T6 add semantic-invariant rules in one place; I5/I6 tighten the lifecycle paths that T7's promotion gate exercises.

**Tests:**
- `tests/lib/install/plan-operations.test.js` — gain `buildPlanDocument-rejects-invalid-shape` case (e.g., add a forbidden field, assert AJV error)
- `tests/lib/install-lifecycle-inspect-merge-json.test.js` (new) — corrupt JSON file, permission-denied file, true drift case — assert three distinct status codes
- `tests/integration/apply-unknown-kind.test.js` (new) — fake `kind: "symlink"` plan operation, assert apply throws with the operation kind in the message + no destination written
- `tests/integration/round-trip-audit-on.test.js` + `tests/integration/round-trip-audit-off.test.js` (new — split from the existing `round-trip.test.js`)

**Exit criteria:**
- All 6 deferred items have at least one positive + one negative test
- `node tests/run-all.js` green
- New `schemas/install-settings.schema.json` validates the same shapes that the legacy duplicated blocks validated, byte-for-byte

---

### Track T6 — Security Defaults & Policy Gates *(the central V1 deliverable)*

#### Outcomes
Profile settings stop being decorative. `allow_mcp:false`, `block_global_install:true`, `hook_profile:"validation"`, and `allowed_mcp_servers` are enforced at plan time and reject installs with explicit `conflicts[]` entries.

#### File deltas

- **NEW** `scripts/lib/install/policy.js`:
  - `evaluatePolicy(resolvedRequest, profileSettings)` → `{ conflicts: PolicyConflict[], warnings: PolicyWarning[] }`
  - Rules:
    - `allow_mcp:false` + selected modules contain any MCP module → emit `{ reason: "mcp-not-allowed", severity: "error" }`
    - `allow_mcp:true` + `allowed_mcp_servers` non-empty + selected mcp module's server NOT in allowlist → same error reason but message names the rejected server
    - `block_global_install:true` + `--scope user` → `{ reason: "global-install-blocked", severity: "error" }`
    - `hook_profile:"validation"` + selected hooks containing any classified as `riskLevel: "high"` → `{ reason: "hook-risk-high", severity: "error" }`
  - Compose with existing `filterMcpConfig` from `scripts/lib/mcp-config.js` — policy decides *whether* the `merge-json` op for `.mcp.json` runs at all; `filterMcpConfig` continues to decide *which servers* survive a permitted merge.

- `scripts/lib/install/plan-operations.js` → import + invoke `evaluatePolicy`; merge results into the document's `conflicts[]` and `warnings[]` before deterministic sort.

- `manifests/install-modules.json` → add optional `riskLevel: "safe" | "medium" | "high"` per hook module entry. Default `"safe"`.

- `scripts/ci/validate-install-manifests.js` → semantic check that any module with `kind: "hooks"` declares a `riskLevel`.

- **NEW** `scripts/ci/scan-secret-shapes.js`:
  - Scans `manifests/`, `schemas/`, `scripts/`, `agents/`, `commands/`, `skills/`, `rules/`, `hooks/` for literal token shapes:
    - `gh[ps]_[A-Za-z0-9]{20,}` (GitHub tokens)
    - `sk-[A-Za-z0-9]{32,}` (OpenAI-style)
    - `ANTHROPIC_API_KEY=sk-ant-[A-Za-z0-9-]{50,}` (Anthropic)
    - `AKIA[0-9A-Z]{16}` (AWS access-key prefix)
  - Allowlist `${ENV_VAR}` and `${{ secrets.NAME }}` placeholders.
  - Add `"scan:secrets": "node scripts/ci/scan-secret-shapes.js"` to `package.json`.

- `scripts/lib/install-manifests.js` → `resolveInstallPlan` consumes `evaluatePolicy` results AFTER request normalization, so `--with mcp:context7` on a profile with `allow_mcp:false` produces a `mcp-not-allowed` conflict instead of silently dropping the component (see also coord note in original plan).

#### Tests

- `tests/lib/install/policy.test.js` (new) — one case per rule (positive + negative for each `reason` value), plus the `--with`-overriding-profile case from the original plan.
- `tests/ci/scan-secret-shapes.test.js` (new) — positive + negative fixtures (real-looking token vs placeholder).
- **Flip** `tests/integration/profile-conflict.test.js`: replace "assert MVP gap" comments with positive assertions. The test file already references `docs/MVP-LIMITATIONS.md` so any reviewer running the diff will see the flip immediately.
- Update affected snapshots: `tests/snapshots/security/install-plan.{claude,codex}.json` should now contain a `global-install-blocked` conflict whenever a `--scope user` is plumbed through; `tests/snapshots/document-ai/install-plan.{claude,codex}.json` adds a `hook-risk-high` conflict if any selected hook is reclassified. Re-run `node tests/integration/lib/generate-snapshots.js`.

#### Exit criteria

- Every V1 profile (8 profiles) passes T6 policy without unintentional high-risk capabilities enabled.
- Secret-shape scanner CI gate green; the test fixtures intentionally contain BOTH valid placeholders + literal tokens (in a `.gitignored` fixtures dir) and assert the scanner classifies correctly.
- `tests/integration/profile-conflict.test.js` flips cleanly — no test in the suite still asserts "MVP gap intact."
- `docs/MVP-LIMITATIONS.md` deleted or replaced with a brief "limitations history" note pointing to T7+T8.

---

### Track T2-rest — Remaining Operation Kinds

The MVP shipped `copy-file` + `merge-json` + `copy-path` (alias). The full plan calls for six more kinds. V1 emits and handles them.

#### Outcomes
`copy-tree`, `flatten-copy`, `render-template`, `merge-jsonc`, `mkdir`, `remove` are first-class — emitted by the planner where appropriate, dispatched in `apply.js`, handled in `install-lifecycle.js`'s repair + uninstall + inspect branches.

#### File deltas
- `scripts/lib/install-executor.js` → factor out the helpers that today encode `copy-tree`/`flatten-copy` shapes inline (search for `addRecursiveCopyOperations`, `addMatchingRuleOperations`). Each should emit operations with the correct `kind` value (today they emit `copy-file` even for tree-style copies — fix in this track).
- `scripts/lib/install/apply.js` → add handlers to the dispatch table (`handleCopyTree`, `handleFlattenCopy`, `handleRenderTemplate`, `handleMergeJsonc`, `handleMkdir`, `handleRemove`). The lifecycle file (`install-lifecycle.js`) already has uninstall/repair branches for most of these — verify alignment.
- `schemas/install-plan.schema.json` + `schemas/install-state.schema.json` → the enum already lists these kinds; the schema doesn't need changes. Audit per-kind required fields.
- **NEW** `scripts/lib/install/render-template.js` — sandboxed template renderer (e.g., handlebars/mustache) for `render-template` ops. Decision point: which engine? Plan-review pass should reconcile.

#### Tests
- One unit test per kind in `tests/lib/install/plan-operations.test.js`
- One round-trip integration test per kind in `tests/integration/round-trip-<kind>.test.js`
- Add new fixtures under `tests/fixtures/operation-kinds/`

#### Exit criteria
- Every kind in the schema enum is emitted by SOME planner path.
- Every kind is uninstallable + repairable.
- Round-trip restores baseline for each.

---

### Track T3b-rest — opencode-home Allowed-Roots

#### Outcomes
`opencode` joins the safety-validated, snapshot-locked target set.

#### File deltas
- `scripts/lib/install-targets/opencode-home.js` → mirror the `allowedRoots` declaration from `claude-home.js`/`codex-home.js`. Derive from `input.targetRoot` first; fall back through `homeDir`; add scope-specific defensive roots (sandbox `./sandbox/home/.opencode`, user `~/.opencode` — no `./.opencode` project mirror since none exists today).
- `tests/lib/install-targets.test.js` → extend allowlist coverage for opencode (mirroring the claude/codex tests).

#### Tests
- Round-trip test for opencode minimal × opencode.
- New snapshots: `tests/snapshots/{minimal,core,developer,security,research}/install-plan.opencode.json` (5 files).

#### Exit criteria
- All 5 general profiles snapshot for `opencode` cleanly.
- Path-safety integration test from MVP passes for opencode adapter.
- `document-ai` + `enterprise` × opencode remain deferred to v1.1 (per original plan).

---

### Track T7 — Promotion Lifecycle & CI Gating

#### Outcomes
A profile can't be released without passing the gate sequence. `lifecycle` setting transitions are gated, not free-form.

#### File deltas
- `scripts/ci/validate-install-manifests.js` → reject releases where any profile has `lifecycle: "promoted"` but ANY of the following gates have not produced an artifact: schema validation, snapshot match, sandbox integration test, uninstall round-trip, policy + secret-shape scan.
- **NEW** `scripts/ci/gate-profile-promotion.js` — orchestrates the five gates above. Idempotent. Outputs `gates-report.json` (consumed by the validator).
- **NEW** `scripts/lib/install/lifecycle-transitions.js` — pure-function state-machine: `draft → candidate → promoted`. Backwards transitions allowed only with `--force` + audit-log entry.
- `.github/workflows/profile-promotion.yml` (new) — runs on PRs that change `manifests/install-profiles.json`; invokes the gate orchestrator.
- `scripts/ecc.js` → add `ecc promote <profileId> --to candidate|promoted` command that calls `lifecycle-transitions.js`.

#### Tests
- `tests/ci/gate-profile-promotion.test.js` — simulate gate failures (force schema break, force snapshot diff, force policy violation, force secret-scan hit) — assert promotion refused with the failing-gate code.
- `tests/lib/install/lifecycle-transitions.test.js` — state-machine coverage.
- `tests/scripts/ecc-promote.test.js` — CLI integration.

#### Exit criteria
- Promoted profiles cannot regress without explicit override.
- Gate failures emit explicit + actionable reasons (e.g., `gate-snapshot-diff`, `gate-policy-mcp-not-allowed`, `gate-secret-shape-match`).

---

### Track T8 — Operator UX & Docs *(promote MVP-LIMITATIONS into a guide)*

#### Outcomes
A fresh operator can complete the safe workflow (`plan` → `apply` in sandbox → review snapshot → promote) from documentation alone.

#### File deltas
- **NEW** `docs/PROFILE-SAFETY-GUIDE.md` — choosing profile by risk; reading plan output; conflict triage (`mcp-not-allowed`, `global-install-blocked`, `hook-risk-high`, `outside-allowed-root`); drift triage via `ecc doctor`.
- `docs/SELECTIVE-INSTALL-ARCHITECTURE.md` → add the safety/profile additions to the existing canonical doc. **Do not rename** — `scripts/release.sh:SELECTIVE_INSTALL_ARCHITECTURE_DOC` reads this path, and `docs/ANTIGRAVITY-GUIDE.md` links it.
- `docs/SELECTIVE-INSTALL-DESIGN.md` → companion update.
- `README.md` → add "Safe first run" section with `ecc plan --profile minimal --target claude --scope sandbox` walkthrough.
- `docs/MVP-LIMITATIONS.md` → replace contents with a "limitations history" pointer to `PROFILE-SAFETY-GUIDE.md` or delete (decision in plan-review).

#### Tests
- `tests/docs/profile-safety-walkthrough.test.js` — assert the documented CLI commands resolve to real flags; assert documented conflict reasons match the enum in `schemas/install-plan.schema.json`.

#### Exit criteria
- Fresh-operator walkthrough completes without source-edits.
- Docs cross-reference each enforcement rule to its `conflicts[].reason`.

---

## Cross-Track Quality Gates (carryover from MVP)

- **Determinism:** byte-identical plan JSON on repeat runs.
- **Idempotence:** re-apply approved plan produces zero mutations.
- **Reversibility:** every operation kind has a registered uninstall handler.
- **Auditability:** plan → apply → uninstall artifacts traceable to profile id + repo commit.
- **Safety defaults:** project-scoped install default; MCP/global/shell-exec hooks off unless explicitly opted in.

---

## Wave Plan

A proposed sequencing — the orchestrator may adjust dependencies.

| Wave | Tracks | Rationale |
|---|---|---|
| **0** | W0 (deferred-patch) | Foundation for everything else. I3 (runtime plan validation) + I10 ($ref schema extraction) directly enable T6's policy schemas. Lands as one wave to keep momentum from the MVP cycle. |
| **1** | T2-rest + T3b-rest | Parallelizable. T2-rest adds operation kinds; T3b-rest adds opencode adapter. Disjoint files (`scripts/lib/install/apply.js` shared, but additive). Lands BEFORE T6 because T6's policy emits conflicts against operation kinds (need them all visible). |
| **2** | T6 | The flagship deliverable. Flips `profile-conflict.test.js` from negative to positive. All 8 profiles must remain green. Touches `policy.js` (new), `plan-operations.js`, `install-manifests.js`, `manifests/install-modules.json`. |
| **3** | T7 | Depends on T6 (gate orchestrator calls `policy.js` + `scan-secret-shapes.js`). |
| **4** | T8 | Trails by one wave so docs match shipped behavior. Snapshot for opencode lands here (depends on T3b-rest + T6's policy stability). |

**Branch strategy:** same as MVP — one feature branch `feature/profiles-deploy-v1`, all waves committed to it, single PR at the end. No interim merges to `main`.

**Per-wave verification (carryover from MVP):**
- Tier T: `node tests/run-all.js` clean
- Tier W (wiring): trace `ecc plan` and `ecc install` from CLI to every new module
- Tier B (behavioral): assert downstream state for each new feature (not just return value)
- Tier S (simplification): non-blocking; logged in status file

---

## Out of Scope for V1 *(deferred to v1.1)*

- Secondary-harness rollout: cursor, gemini, qwen, antigravity, codebuddy, joycode `allowedRoots` declarations + snapshots
- `document-ai` and `enterprise` profiles × `opencode` snapshots
- Hook risk classification beyond `safe / medium / high` — granular per-hook policy
- MCP allowlist beyond `["context7", "github"]`
- Audit-log rotation
- T6 policy enforcement at `repair`-time (MVP wired audit-log only to install + uninstall; repair stays declarative until v1.1)
- Migration of `copy-path` → `copy-file` (or vice-versa) — picked one canonical name and migrate via `migrateInstallState`

---

## Open Questions *(resolve before launching Wave 0)*

1. **Render-template engine choice (T2-rest).** Handlebars, Mustache, or roll-our-own minimal substituter? Lean toward Mustache (smaller surface, no helpers ⇒ less to lock down for `hook_profile: validation`).
2. **CI workflow file scope (T7).** Are GitHub Actions in scope, or does the project run CI elsewhere? `.github/workflows/` exists in repo — verify before adding the promotion job.
3. **`MVP-LIMITATIONS.md` end-state (T8).** Delete entirely once T6 ships, or rewrite as a "v1 limitations" doc enumerating v1.1 deferrals? Recommend rewrite — operators benefit from a single canonical "what's not enforced yet."
4. **Coord-note correction.** Original MVP scope's coord note 3 referenced `scripts/lib/state-store/migrations.js` for the v1→v2 migration — that file is SQLite-only. MVP correctly placed the migration in `scripts/lib/install-state.js`. V1 plan-review should verify this is reflected in the V1 brief if the brief is regenerated.

---

## Acceptance Criteria

```
[ ] All 6 PR #2 deferred review items closed with tests (W0)
[ ] schemas/install-settings.schema.json + schemas/install-operations.schema.json extracted; no duplicate enums (I10)
[ ] install-plan documents validated at runtime via AJV (I3)
[ ] All 8 profiles still validate; tests/integration/profile-conflict.test.js flipped from negative to positive (T6)
[ ] secret-shape scanner CI-gated; positive + negative fixtures committed (T6)
[ ] Every operation kind in schemas/install-plan.schema.json's enum has a planner path that emits it + a lifecycle handler (T2-rest)
[ ] opencode round-trip green for 5 general profiles; 5 opencode snapshots committed (T3b-rest)
[ ] gate-profile-promotion.js refuses to mark a profile "promoted" with any failing prerequisite (T7)
[ ] docs/PROFILE-SAFETY-GUIDE.md walkthrough passes its own test (T8)
[ ] node tests/run-all.js green; no per-wave regression
```

---

## Risk Notes

- **Snapshot churn from T6.** Adding `conflicts[]` entries for the V1 gap will diff 8+ snapshots in PR review. Land T6 as a single wave commit with a clear diff hint in the commit message. Reviewers should grep for `mcp-not-allowed` / `global-install-blocked` / `hook-risk-high` in the snapshot diff and confirm one entry per affected profile.
- **Schema $ref tooling.** The fallback validator in `scripts/lib/install-state.js` (`createFallbackValidator`) is hand-rolled and does NOT understand `$ref`. After I10's extraction, either teach the fallback validator to resolve refs, or drop the fallback entirely and make AJV a hard dependency (it's already in `package.json`).
- **T7 + CI scope.** If the project doesn't run GitHub Actions today, T7's CI job is dead weight. Confirm in open question 2 before implementing.
- **Coord-note 4 boundary tests.** `tests/integration/profile-conflict.test.js` is intentionally a tripwire; flipping it is the V1 contract. Any T6 PR that does NOT flip these assertions has incomplete enforcement — review checklist item.
