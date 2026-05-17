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
| **I10** | type-design | Settings block + `operations[].kind` enum are duplicated across `install-profiles.schema.json` and `install-state.schema.json` / `install-plan.schema.json`. Drift risk. | Extract `schemas/install-settings.schema.json` and `schemas/install-operations.schema.json` with `$ref` from the consumers. **Resolves [plan-review BLOCK fallback-validator]:** since the hand-rolled `createFallbackValidator` in `scripts/lib/install-state.js` does not resolve `$ref`, I10 also makes `ajv` a hard dependency — delete `createFallbackValidator` and the `Ajv = null` fallback branch (`install-state.js:9–12`). `ajv` is already in `package.json`, so this is a code deletion, not a new dep. |

**Why first:** Wave 0 lands the foundations that subsequent tracks consume — I3 enforces the install-plan contract that T6's policy gate emits into; I10's shared schemas let T6 add semantic-invariant rules in one place; I5/I6 tighten the lifecycle paths that T7's promotion gate exercises.

#### W0/I5+I6 — Caller propagation (closes plan-review BLOCK #3)

I5 changes `inspectManagedOperation` to return three new statuses: `parse-error`, `permission-error`, `drifted`. I6 changes `areFilesEqual` to re-throw EACCES/EMFILE/ELOOP/EBUSY instead of swallowing them. The single caller chain (`inspectManagedOperation` → `analyzeRecord` at `scripts/lib/install-lifecycle.js:629` → doctor + repair) must be updated explicitly:

1. **`analyzeRecord`** — switch on the new statuses; surface `permission-denied` and `parse-error` as **separate** entries in the `issues[]` summary (not lumped into `drifted`).
2. **`executeRepairOperation` (`install-lifecycle.js:312`)** — refuse to repair when the inspection returned `parse-error` (the destination contains user data the parser couldn't load; overwriting it is the destructive behavior I5 was designed to prevent). Return a `repair-refused-parse-error` status code.
3. **`doctor` JSON report** — extend the issue-code vocabulary with `permission-denied` and `parse-error`. Document in `docs/PROFILE-SAFETY-GUIDE.md` (T8) under "drift triage."
4. **`tests/lib/install-lifecycle.test.js`** — existing tests that exercise the old binary `drifted` partition must be updated for the new three-way partition. The W0 commit MUST run the existing suite green; any test that depended on the old swallowing behavior is itself a test of a contract we are intentionally breaking and must be rewritten.

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
  - **Input shape contract (closes plan-review BLOCK #2):** `resolvedRequest.selectedModules` MUST be the array of **full module objects** returned by `resolveInstallPlan` (line 584 of `install-manifests.js`), NOT the string-ID shape stored on state's `resolution.selectedModules` (line 688 of `install-executor.js`). The `riskLevel` field needed for the `hook-risk-high` rule lives on the full objects only. Add a runtime assertion at the top of `evaluatePolicy`: if `selectedModules[0]` exists and is not an object with an `id` field, throw `evaluatePolicy: expected full module objects, got string IDs`.
  - Rules:
    - `allow_mcp:false` + selected modules contain any MCP module → emit `{ reason: "mcp-not-allowed", severity: "error" }`
    - `allow_mcp:true` + `allowed_mcp_servers` non-empty + selected mcp module's server NOT in allowlist → same error reason but message names the rejected server
    - `block_global_install:true` + `--scope user` → `{ reason: "global-install-blocked", severity: "error" }`
    - `hook_profile:"validation"` + selected hooks containing any classified as `riskLevel: "high"` → `{ reason: "hook-risk-high", severity: "error" }`
  - Compose with existing `filterMcpConfig` from `scripts/lib/mcp-config.js` — policy decides *whether* the `merge-json` op for `.mcp.json` runs at all; `filterMcpConfig` continues to decide *which servers* survive a permitted merge.
  - **Also exports `assertNoBlockingConflicts(planDocument)` (closes plan-review BLOCK #1):** scans `planDocument.conflicts[]`; if any entry has `severity: "error"`, emits one `[policy] refusing install: <reason> (<destination>)` line to stderr per blocking conflict, then throws `Error("install refused: <N> blocking conflict(s)")`. The throw is what makes runtime enforcement actually enforce — without it T6 ships another declarative-only cycle. The stderr line gives operators a diagnosable trace.

- `scripts/lib/install/plan-operations.js` → import + invoke `evaluatePolicy`; merge results into the document's `conflicts[]` and `warnings[]` before deterministic sort.

- **`scripts/install-apply.js` AND `scripts/lib/install-executor.js:applyInstallPlan` wrapper (closes plan-review BLOCK #1):** call `assertNoBlockingConflicts(planDocument)` BEFORE any `applyInstallPlan` invocation. The check fires on EVERY entry point that mutates the filesystem (CLI install, executor calls from lifecycle/repair). Without this wiring, conflicts are advisory and the install still completes — which is exactly the MVP gap T6 is shipping to close.

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
  - **Test fixture strategy (closes plan-review WARN scan-secret-fixtures):** `tests/ci/scan-secret-shapes.test.js` generates its positive + negative fixtures into a per-test tmpdir during `beforeAll`-style setup. Do NOT commit fixture files containing realistic-looking token shapes (even fake) — they can trip GitHub's push protection and inflate the diff with files that grep tooling will misread. The fixtures live in `os.tmpdir()` for the duration of the test run only.

- `scripts/lib/install-manifests.js` → `resolveInstallPlan` consumes `evaluatePolicy` results AFTER request normalization, so `--with mcp:context7` on a profile with `allow_mcp:false` produces a `mcp-not-allowed` conflict instead of silently dropping the component (see also coord note in original plan).

#### Tests

- `tests/lib/install/policy.test.js` (new) — one case per rule (positive + negative for each `reason` value), plus the `--with`-overriding-profile case from the original plan.
- `tests/ci/scan-secret-shapes.test.js` (new) — positive + negative fixtures (real-looking token vs placeholder).
- **Flip** `tests/integration/profile-conflict.test.js`: replace "assert MVP gap" comments with positive assertions. The test file already references `docs/MVP-LIMITATIONS.md` so any reviewer running the diff will see the flip immediately.
- Update affected snapshots: `tests/snapshots/security/install-plan.{claude,codex}.json` should now contain a `global-install-blocked` conflict whenever a `--scope user` is plumbed through; `tests/snapshots/document-ai/install-plan.{claude,codex}.json` adds a `hook-risk-high` conflict if any selected hook is reclassified. Re-run `node tests/integration/lib/generate-snapshots.js`.

#### Exit criteria

- Every V1 profile (8 profiles) passes T6 policy without unintentional high-risk capabilities enabled.
- Secret-shape scanner CI gate green; fixtures generated in tmpdir at test time.
- `tests/integration/profile-conflict.test.js` flips cleanly — no test in the suite still asserts "MVP gap intact."
- **A new integration test asserts that `applyInstallPlan` THROWS when handed a plan with `severity:"error"` conflicts** (the runtime-enforcement contract from BLOCK #1). Belt-and-suspenders for the wiring check.
- `docs/MVP-LIMITATIONS.md` deleted or replaced with a brief "limitations history" note pointing to T7+T8.

#### Optional split: T6a / T6b

If review burden becomes painful (≥7 production files touched, ~10 snapshot diffs), the track can split into:
- **T6a — Runtime enforcement core:** `policy.js` (rules + `assertNoBlockingConflicts`), `plan-operations.js` wiring, `install-apply.js`/`install-executor.js` refusal calls, flipped `profile-conflict.test.js`. Single-PR; ships the actual MVP-gap closure.
- **T6b — Hardening overlay:** `scan-secret-shapes.js`, `riskLevel` field on `install-modules.json`, hook risk classification rule, CI semantic check for hooks `riskLevel`. Ships after T6a is merged.
Not required; mention only if Wave 2's PR review reports >2h triage time.

---

### Track T2-rest — Remaining Operation Kinds

The MVP shipped `copy-file` + `merge-json` + `copy-path` (alias). The full plan calls for six more kinds. V1 emits and handles them.

#### Outcomes
`copy-tree`, `flatten-copy`, `render-template`, `merge-jsonc`, `mkdir`, `remove` are first-class — emitted by the planner where appropriate, dispatched in `apply.js`, handled in `install-lifecycle.js`'s repair + uninstall + inspect branches.

#### File deltas
- `scripts/lib/install-executor.js` → factor out the helpers that today encode `copy-tree`/`flatten-copy` shapes inline (search for `addRecursiveCopyOperations`, `addMatchingRuleOperations`). Each should emit operations with the correct `kind` value (today they emit `copy-file` even for tree-style copies — fix in this track).
- `scripts/lib/install/apply.js` → add handlers to the dispatch table (`handleCopyTree`, `handleFlattenCopy`, `handleRenderTemplate`, `handleMergeJsonc`, `handleMkdir`, `handleRemove`). The lifecycle file (`install-lifecycle.js`) already has uninstall/repair branches for most of these — verify alignment.
- `schemas/install-plan.schema.json` + `schemas/install-state.schema.json` → the enum already lists these kinds; the schema doesn't need changes. Audit per-kind required fields.
- **NEW** `scripts/lib/install/render-template.js` — Mustache-based template renderer for `render-template` ops. **Engine choice locked: Mustache** (resolves plan-review WARN render-template-engine). Rationale: smaller surface than Handlebars (no helpers to lock down for `hook_profile: "validation"`); permissive license; logic-less templates compose cleanly with the policy guardrails T6 ships. Dependency: `mustache` (~5KB, no transitive deps). Wrap in `renderTemplate(templateString, context, { allowedKeys })` so policy can restrict which context keys are reachable (an in-place defence-in-depth against template variables that leak path data).

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

#### Lifecycle storage location (closes plan-review BLOCK #4)

**Decision: in-place manifest edit.** `ecc promote` rewrites `manifests/install-profiles.json` directly, updating `profiles.<id>.settings.lifecycle`. Rationale:
- The manifest is the existing source-of-truth; a sidecar would create a split-brain between declared default vs. runtime truth.
- Lifecycle transitions are infrequent enough (per-release, not per-build) to justify a tracked commit per transition.
- A stable JSON formatter (`scripts/lib/json-format.js`, new — uses `JSON.stringify(obj, null, 2) + '\n'` with sorted profile keys preserved by the manifest's existing ordering) keeps diffs minimal.

Trade-offs accepted: each `ecc promote` produces a file diff that must land via PR; CI must permit lifecycle-only PRs (no other file changes) — this is enforced by the gate orchestrator, which refuses promotion if the only diff is `settings.lifecycle`-bumping without the required gate artifacts attached.

#### File deltas
- `scripts/ci/validate-install-manifests.js` → reject releases where any profile has `lifecycle: "promoted"` but ANY of the following gates have not produced an artifact: schema validation, snapshot match, sandbox integration test, uninstall round-trip, policy + secret-shape scan.
- **NEW** `scripts/ci/gate-profile-promotion.js` — orchestrates the five gates above. Idempotent. Outputs `gates-report.json` (consumed by the validator).
- **NEW** `scripts/lib/install/lifecycle-transitions.js` — pure-function state-machine: `draft → candidate → promoted`. Backwards transitions allowed only with `--force` + audit-log entry. Exports `applyTransition(manifestPath, profileId, toState, options) → { from, to, manifestPath }` that writes the manifest in place via the new `scripts/lib/json-format.js` formatter.
- **NEW** `scripts/lib/json-format.js` — single canonical writer: `writeJsonFile(path, value)` with 2-space indent + trailing newline + preserved insertion order of nested object keys. Used by `lifecycle-transitions.js`; future utilities that mutate tracked JSON manifests should also use it.
- `.github/workflows/profile-promotion.yml` (new) — runs on PRs that change `manifests/install-profiles.json`; invokes the gate orchestrator. (Repo already uses GitHub Actions — confirmed via `ls .github/workflows/`, with existing `ci.yml`, `release.yml`, `reusable-*.yml` files — so this is additive, not a new infrastructure dependency.)
- `scripts/ecc.js` → add `ecc promote <profileId> --to candidate|promoted` command that calls `lifecycle-transitions.applyTransition(...)`.

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
| **1** | T2-rest **then** T3b-rest *(sequential within wave — closes plan-review WARN)* | T2-rest changes which operation kinds the planner emits, which causes every snapshot to diff (claude/codex existing + opencode new). T3b-rest's new opencode snapshots MUST reflect post-T2-rest kinds. Sequence: commit T2-rest first; T3b-rest commits opencode `allowedRoots` + snapshots second, on the same wave branch. The files are disjoint, but the snapshot determinism contract is not. |
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

## Open Questions

*Resolved by the 2026-05-17 plan-review patches:*

- ~~Render-template engine choice~~ — **locked: Mustache** (see T2-rest).
- ~~CI workflow scope~~ — **confirmed: GitHub Actions** (existing `.github/workflows/` confirmed via plan-review grep; T7's workflow is additive).
- ~~Fallback-validator strategy~~ — **locked: drop the fallback in W0/I10** and make `ajv` a hard dependency.
- ~~T7 lifecycle storage location~~ — **locked: in-place manifest edit** via `scripts/lib/json-format.js`.

*Still outstanding:*

1. **`MVP-LIMITATIONS.md` end-state (T8).** Delete entirely once T6 ships, or rewrite as a "v1 limitations" doc enumerating v1.1 deferrals? Recommend rewrite — operators benefit from a single canonical "what's not enforced yet."
2. **Coord-note correction.** Original MVP scope's coord note 3 referenced `scripts/lib/state-store/migrations.js` for the v1→v2 migration — that file is SQLite-only. MVP correctly placed the migration in `scripts/lib/install-state.js`. V1 plan-review should verify this is reflected in the V1 brief if the brief is regenerated.

---

## Acceptance Criteria

```
[ ] All 6 PR #2 deferred review items closed with tests (W0)
[ ] schemas/install-settings.schema.json + schemas/install-operations.schema.json extracted; no duplicate enums (I10)
[ ] install-state.js fallback validator removed; ajv is a hard dependency (W0/I10)
[ ] install-plan documents validated at runtime via AJV (I3)
[ ] inspectManagedOperation distinguishes parse-error/permission-error/drifted; analyzeRecord + executeRepairOperation handle all three; areFilesEqual re-throws non-ENOENT errors (W0/I5+I6)
[ ] All 8 profiles still validate; tests/integration/profile-conflict.test.js flipped from negative to positive (T6)
[ ] applyInstallPlan THROWS when handed a plan containing severity:"error" conflicts (T6 runtime enforcement contract)
[ ] policy.js reads selectedModules as full module objects (not state-shape strings); runtime assertion guards the boundary (T6)
[ ] [policy] stderr line emitted per blocking conflict before the throw (T6 observability)
[ ] secret-shape scanner CI-gated; fixtures generated in tmpdir at test time (T6)
[ ] Every operation kind in schemas/install-plan.schema.json's enum has a planner path that emits it + a lifecycle handler (T2-rest)
[ ] render-template uses Mustache; allowedKeys context-restriction enforced (T2-rest)
[ ] opencode round-trip green for 5 general profiles; 5 opencode snapshots committed (T3b-rest, AFTER T2-rest within Wave 1)
[ ] gate-profile-promotion.js refuses to mark a profile "promoted" with any failing prerequisite (T7)
[ ] ecc promote <id> --to <state> rewrites manifests/install-profiles.json in place via scripts/lib/json-format.js (T7)
[ ] docs/PROFILE-SAFETY-GUIDE.md walkthrough passes its own test (T8)
[ ] node tests/run-all.js green; no per-wave regression
```

---

## Risk Notes

- **Snapshot churn from T6.** Adding `conflicts[]` entries for the V1 gap will diff 8+ snapshots in PR review. Land T6 as a single wave commit with a clear diff hint in the commit message. Reviewers should grep for `mcp-not-allowed` / `global-install-blocked` / `hook-risk-high` in the snapshot diff and confirm one entry per affected profile.
- **Snapshot churn from T2-rest.** New operation kinds will replace `copy-path` entries with more accurate `copy-tree` / `flatten-copy` etc. in every snapshot. This is the explicit reason Wave 1 sequences T2-rest before T3b-rest — review check item: opencode snapshots must already reflect post-T2-rest kinds when they land.
- **Coord-note 4 boundary tests.** `tests/integration/profile-conflict.test.js` is intentionally a tripwire; flipping it is the V1 contract. Any T6 PR that does NOT flip these assertions has incomplete enforcement — review checklist item.
- **`ajv` becomes a hard dep (W0/I10).** Today `install-state.js:9–12` wraps the require in a try/catch with a hand-rolled fallback validator. Removing the fallback assumes every environment that imports `install-state.js` has `ajv` available; verify install scripts (`scripts/install.sh`, `scripts/install.ps1`) call `npm install` / `yarn install` before any code path uses the validator. If a bare-checkout path exists (e.g., release tarballs), document that path's requirement.
- **`ecc promote` writes tracked manifests.** Per T7's locked decision, each `--to` transition emits a `git diff` against `manifests/install-profiles.json`. PR review must catch lifecycle-only diffs that lack the gate artifact — gate orchestrator enforces this server-side, but local pre-commit hooks may also want a check.
