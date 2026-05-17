# ECC Profile-Based Deployment Plan — Rebased on Existing Foundation

**Plan date:** 2026-05-17
**Replaces:** prior greenfield draft (rejected by plan-review: TypeScript scaffolding, `installer/` dir, `test/` paths, invented `agent-harness` CLI — all collided with the implemented foundation).
**Graph-verified:** cross-checked against `codebase-graph.json` (185 nodes / 282 edges, generated 2026-05-17). See **§0.5 Graph-Verified Baseline Corrections** below for the six concrete drifts found between the previous revision of this plan and the actual codebase.

## Sources
- `.claude/plan/Deployment_Specification.md.md` — capability targets (profiles, safety, isolation, lifecycle).
- `.claude/plan/Profile-Based Installation and Isolated Testing for \`everything-claude-code\`.md` — philosophy and rationale.
- `docs/SELECTIVE-INSTALL-ARCHITECTURE.md` — **the actual baseline this work evolves**. Also referenced by `scripts/release.sh:SELECTIVE_INSTALL_ARCHITECTURE_DOC` — release tooling reads this path, so renames are breaking.
- `docs/SELECTIVE-INSTALL-DESIGN.md` — companion design doc.
- `codebase-graph.json` — 3-layer architecture knowledge graph used to verify every "Already implemented" claim below.
- `.claude/rules/node.md` — language conventions (CommonJS, plain `.js`, tests in `tests/`).

## Guiding Principle
> Agent behavior is infrastructure. Selective install already exists as a vertical slice — this work hardens it into a **profiled, safety-gated, reversible, sandbox-validated** deployment system.

## In-Scope Targets

This plan's safety, profile-settings, path-safety, snapshot, and lifecycle work is scoped to **three harness targets**:

- **`claude`** — `scripts/lib/install-targets/claude-home.js`
- **`codex`** — `scripts/lib/install-targets/codex-home.js`
- **`opencode`** — `scripts/lib/install-targets/opencode-home.js`

The other six adapters that exist in `scripts/lib/install-targets/` (`cursor-project`, `gemini-project`, `qwen-home`, `antigravity-project`, `codebuddy-project`, `joycode-project`) remain in the codebase and continue to function under today's behavior, but they are **out of scope** for this plan — they do not need `allowedRoots()` declarations, snapshot fixtures, or profile-`targets` registration in this milestone. A follow-up track (`v1.1: secondary-harness rollout`) can extend the same machinery to them once the v1 contract is stable. Trae has no adapter at all (see §0.5 item 6) and stays out of scope.

---

## 0 Foundation Baseline (What Exists vs. What's Missing)

### Already implemented (do not rebuild)

| Concern | File(s) |
|---|---|
| CLI surface | `scripts/ecc.js` (`install`, `plan`, `list-installed`, `doctor`, `repair`, `uninstall`) |
| Install command | `scripts/install-apply.js` |
| Plan/inspect | `scripts/install-plan.js` |
| Lifecycle | `scripts/list-installed.js`, `scripts/doctor.js`, `scripts/repair.js`, `scripts/uninstall.js` |
| Request normalization | `scripts/lib/install/request.js`, `scripts/lib/install/runtime.js`, `scripts/lib/install/config.js` |
| Apply engine | `scripts/lib/install/apply.js`, `scripts/lib/install-executor.js` |
| Manifests resolver | `scripts/lib/install-manifests.js` |
| Target adapters | `scripts/lib/install-targets/{claude-home,codex-home,cursor-project,gemini-project,opencode-home,qwen-home,antigravity-project,codebuddy-project,joycode-project,registry,helpers}.js` |
| State store | `scripts/lib/install-state.js`, `scripts/lib/state-store/{index,migrations,queries,schema}.js`, `scripts/lib/install-lifecycle.js` |
| Module manifest | `manifests/install-modules.json` |
| Profile manifest | `manifests/install-profiles.json` (profiles: `minimal`, `core`, `developer`, `security`, `research`, `full`) |
| Component manifest | `manifests/install-components.json` |
| Schemas | `schemas/install-modules.schema.json`, `schemas/install-profiles.schema.json`, `schemas/install-state.schema.json`, `schemas/install-components.schema.json`, `schemas/hooks.schema.json`, `schemas/plugin.schema.json`, `schemas/state-store.schema.json`, `schemas/provenance.schema.json`, `schemas/ecc-install-config.schema.json` |
| CI validation | `scripts/ci/validate-install-manifests.js` |
| Tests | `tests/lib/install-{manifests,executor,state,lifecycle,request,config,targets}.test.js`, `tests/scripts/install-{plan,apply,sh,ps1}.test.js`, `tests/scripts/uninstall.test.js`, `tests/scripts/list-installed.test.js` |
| Test runner | `tests/run-all.js` |

### Gaps versus the deployment spec (these are the actual deliverables)

| Capability gap | Spec section |
|---|---|
| **Typed operation graph** (today exactly two kinds are emitted: `'copy-file'` at `scripts/lib/install-executor.js:137` and `'merge-json'` at `:217`; spec needs additionally `copy-tree`, `flatten-copy`, `render-template`, `merge-jsonc`, `mkdir`, `remove`) | spec §8 |
| **Plan `safety` block** (`dryRunRequired`, `globalInstallAllowed`, `mcpAllowed`, `allDestinationsInsideAllowedRoots`) | spec §8 |
| **Plan `conflicts[]` with `severity` + `reason`** as first-class output | spec §8 |
| **Profile `settings` extension** (`scope`, `hook_profile`, `allow_mcp`, `require_dry_run_first`, `require_audit_log`, `block_global_install`, `write_scope`) | spec §5 |
| **Sandbox isolation roots policy** (`./sandbox/home`, `./sandbox/project`, `./sandbox/state`) + path-traversal/symlink protection | spec §10, §11 |
| **MCP allowlist** when `allow_mcp: true` | spec §14.2 |
| **Hook risk classification** (safe/medium/high) + default-deny on high-risk | spec §14.3 |
| **Audit-log capture** (profile-gated) | spec §14, §5.4 |
| **`document-ai` profile**, **`enterprise` profile** | spec §5.4, §6 |
| **Snapshot tests** per profile/target pair (deterministic plan output) | spec §12.3 |
| **Promotion lifecycle** (`draft → candidate → promoted`) gating release | spec §13.3 |
| **Secret-shape scan** rejecting literal tokens in config | spec §14.4 |

### Decisions locked in (resolves prior plan's ambiguities)

1. **Composition model:** module-based (extend `manifests/install-modules.json` + `install-profiles.json`). Do **not** introduce a parallel `includes: { rules, skills, agents, hooks }` shape.
2. **Language:** plain CommonJS `.js` per `.claude/rules/node.md`. All new files end in `.js`; types expressed as JSON Schema + JSDoc.
3. **Test root:** `tests/` (plural). New files: `tests/lib/install/*.test.js`, `tests/integration/*.test.js`, `tests/snapshots/*`, `tests/fixtures/*`.
4. **CLI:** extend `scripts/ecc.js` registry — no new top-level CLI name. New flags land on existing `ecc install` / `ecc plan` / `ecc uninstall` commands. The `plan` command also has an `install-plan` alias in the COMMANDS registry; both names must keep working.
5. **Keep `core` profile.** Add `document-ai` and `enterprise` alongside.
6. **Operation-kind backward compatibility:** existing install-state records use `kind: "copy-file"` (not `"copy"`). The typed-op rollout keeps `"copy-file"` as the canonical name for single-file copy and **adds** new kinds alongside; no rename of existing records. A migration approach is only required if we choose to converge on the spec name `"copy"` — see §0.5 item (1).

---

## 0.5 Graph-Verified Baseline Corrections

These six items were verified by traversing `codebase-graph.json` plus targeted reads. Each tightens an earlier claim in §0 or in a track section.

1. **Emitted operation kinds today are `'copy-file'` and `'merge-json'` only.** Plan v1 said "mostly `copy`" — incorrect. T2 must keep `'copy-file'` as the spelling unless it ships a state-file migration; the install-state schema records this kind verbatim (`schemas/install-state.schema.json` defines `operations[].kind` as a free-form non-empty string with `additionalProperties: true`, so renaming requires both a planner change and a state-loader migration).
2. **`schemas/install-profiles.schema.json` has `additionalProperties: false`** with only `description` + `modules` allowed today. T1's schema edit therefore **must land before** any manifest edit that introduces `targets` or `settings` — otherwise CI validation will fail on the manifest. Wave plan: schema PR → manifest PR.
3. **`schemas/install-state.schema.json` currently has no enum on `operations[].kind`** and `additionalProperties: true` on each operation. T5's "ensure `operations[].kind` enum matches the planner" is a **new constraint**, not a tightening — old state files written before this change will fail validation unless we either (a) version-bump `schemaVersion` and migrate on load, or (b) make the enum a soft warn for `schemaVersion < N`. Pick one explicitly in T5.
4. **Path-safety integration points in `scripts/lib/install-targets/helpers.js`** are concrete functions, not abstract pipeline: `createManagedOperation`, `createRemappedOperation`, `createFlatFileOperations`, `createFlatRuleOperations`, and `resolveBaseRoot` are the destinations-resolution sites; `createInstallTargetAdapter` wires adapter input validation. T3a hooks into these by name (see updated track section).
5. **MCP filtering already exists in the apply path.** `scripts/lib/install/apply.js:7` imports `filterMcpConfig, parseDisabledMcpServers` from `scripts/lib/mcp-config.js`; `apply.js:120,145` already disables servers listed in `ECC_DISABLED_MCPS` when writing `.mcp.json` / `mcp.json` (matched by `isMcpConfigPath` at `apply.js:88`). T6's MCP allowlist **composes** with this (deny-by-default plus explicit allow list), it does not replace it. Reuse `mcp-config.js` helpers.
6. **Trae has a test but no adapter — out of scope.** `tests/scripts/trae-install.test.js` and `.trae/` exist, but `scripts/lib/install-targets/` has **no `trae-project.js`**. The registry has 9 adapters (claude-home, codex-home, cursor-project, gemini-project, opencode-home, qwen-home, antigravity-project, codebuddy-project, joycode-project). Of those, this plan touches only the three in-scope targets — see **In-Scope Targets** above. The existing Trae test stays as-is.

Bonus context surfaced by the graph that affects scope but isn't a correction:

- `tests/lib/selective-install.test.js` already exercises **`--with` / `--without` CLI flags** for include/exclude of component IDs and standalone-`--with` (no profile). T1's `settings` block must compose cleanly with these flags — e.g., does `allow_mcp: false` override a user-supplied `--with mcp:context7`? Today the request normalizer in `scripts/lib/install/request.js` and the executor in `scripts/lib/install-executor.js` already merge profile + with/without into a resolved request; T6's policy gate runs **after** that merge and emits a `conflicts[]` entry rather than silently dropping. Make this explicit in T6.
- `scripts/release.sh` reads `SELECTIVE_INSTALL_ARCHITECTURE_DOC="docs/SELECTIVE-INSTALL-ARCHITECTURE.md"` — T8 edits to that doc must not break the release script's path lookup.

---

## 1 Profile Strategy (Module-Based, Settings-Augmented)

Existing profile shape:
```json
{ "description": "...", "modules": ["rules-core", "agents-core", "..."] }
```

New profile shape (additive, all `settings.*` optional with safe defaults):
```json
{
  "description": "...",
  "modules": ["rules-core", "..."],
  "targets": ["claude", "codex"],
  "settings": {
    "scope": "project | user | sandbox",
    "hook_profile": "none | standard | strict | validation",
    "allow_mcp": false,
    "allowed_mcp_servers": [],
    "require_dry_run_first": true,
    "require_audit_log": false,
    "block_global_install": false,
    "write_scope": "project-only | project-local | controlled",
    "lifecycle": "draft | candidate | promoted"
  }
}
```

### v1 profile rollout

All profiles below default `targets: ["claude", "codex", "opencode"]` unless explicitly narrowed. Other adapters in the repo continue to accept these profiles informally; this column declares which targets are **safety-validated, snapshot-locked, and gate-promoted** by this plan.

| Profile | Status | Modules | `targets` (in-scope) | Settings highlights |
|---|---|---|---|---|
| `minimal` | exists — augment | `rules-core`, `agents-core`, `commands-core`, `platform-configs`, `workflow-quality` | `["claude", "codex", "opencode"]` | `hook_profile: none`, `allow_mcp: false`, `write_scope: project-only` |
| `core` | exists — augment | + `hooks-runtime` | `["claude", "codex", "opencode"]` | `hook_profile: standard` |
| `developer` | exists — augment | + `framework-language`, `database`, `orchestration` | `["claude", "codex", "opencode"]` | `hook_profile: standard`, `write_scope: project-local` |
| `security` | exists — augment | + `security` module | `["claude", "codex", "opencode"]` | `hook_profile: strict`, `block_global_install: true`, `allow_mcp: false` |
| `research` | exists — augment | + `research-apis` | `["claude", "codex", "opencode"]` | `hook_profile: standard`, `allow_mcp: false` (override per consumer) |
| `document-ai` | **new** | TBD via Track 2 module additions | `["claude", "codex"]` (opencode deferred to v1.1) | `hook_profile: validation`, `require_audit_log: true` |
| `enterprise` | **new** | superset, allowlisted MCP only | `["claude", "codex"]` (opencode deferred to v1.1) | `block_global_install: false` (controlled), `require_audit_log: true`, `allowed_mcp_servers: ["context7","github"]` |
| `full` | exists | keep as-is | unchanged | no change |

---

## 2 Architecture Phasing (aligned with `SELECTIVE-INSTALL-ARCHITECTURE.md`)

This plan adopts the architecture doc's 4-phase split and layers safety/profile features onto each phase.

- **Phase 1 — Planner to Contract:** typed operation graph, `safety` block, `conflicts[]`, plan-schema enforcement.
- **Phase 2 — Target Adapters:** real merge/remove semantics in `install-targets/*.js`; path safety + symlink/traversal guards.
- **Phase 3 — Lifecycle:** repair/uninstall over typed operations; audit-log capture; doctor reports settings drift.
- **Phase 4 — Publish & Future Targets:** narrow publish surface, MCP allowlist enforcement, promotion gating in CI.

Tracks below cut across phases for parallelism.

---

## Track 1 — Profile Schema & Settings Extension (Phase 1)

### Outcomes
Profile-level safety settings expressed declaratively; validator rejects unsafe combinations.

### File deltas
- `schemas/install-profiles.schema.json` → add optional `targets`, `settings` block (all keys above, including `lifecycle: "draft" | "candidate" | "promoted"`) with enums. **Required first PR in this track:** schema currently has `additionalProperties: false` on each profile (only `description` + `modules` allowed), so any manifest edit that introduces `settings` will fail CI validation until this schema PR merges.
- `manifests/install-profiles.json` → add `settings` block (with `lifecycle`) to existing 6 profiles (`minimal`, `core`, `developer`, `security`, `research`, `full`); add `document-ai` and `enterprise` entries. Land **after** the schema PR. Initial `lifecycle` defaults to `"draft"`; promotion happens later via T7's gate orchestrator (which only edits the validator, not this manifest).
- `scripts/ci/validate-install-manifests.js` → extend with semantic checks:
  - `allow_mcp: true` ⇒ `allowed_mcp_servers` non-empty.
  - `block_global_install: true` ⇒ reject `scope: user`.
  - `hook_profile: validation` ⇒ `require_audit_log: true`.
- `scripts/lib/install-manifests.js` → expose `settings` on resolved-profile object.

### Tests (new under `tests/lib/`)
- `tests/lib/install-profile-settings.test.js` — schema validation, default fill-in, semantic checks.
- `tests/lib/install-manifests-settings.test.js` — resolver surfaces `settings`.

### Exit Criteria
- All 8 profiles validate with new schema.
- Semantic-violation fixtures fail with actionable messages.

---

## Track 2 — Typed Operation Planner (Phase 1)

### Outcomes
`ecc plan` emits typed-operation graph with `safety` + `conflicts[]`; deterministic JSON output.

### File deltas
- `scripts/install-plan.js` → add `--format json` (if not already), surface new fields.
- `scripts/lib/install-executor.js` → extract operation construction into new module. The existing entry point is `applyInstallPlan(plan)` plus helpers `buildCopyFileOperation`, `addRecursiveCopyOperations`, `addFileCopyOperation`, `addJsonMergeOperation`, `addMatchingRuleOperations`. These move into the new module (or get re-exported through it):
  - **new:** `scripts/lib/install/plan-operations.js` — pure function `buildOperations(resolvedRequest, adapter) → InstallOperation[]`.
- Operation kinds. The two **already emitted** kinds keep their exact spelling for state-file backward compatibility (see §0.5 item 1):
  - `copy-file` (existing — single-file copy, the workhorse kind)
  - `merge-json` (existing — used for `.mcp.json` / `mcp.json` merge in `apply.js:125,145`)
  - **new kinds added by T2:** `copy-tree`, `flatten-copy`, `render-template`, `merge-jsonc`, `mkdir`, `remove`.
  - `apply.js` currently branches on `kind === 'merge-json'` (line 125) and `kind === 'copy-file' && isMcpConfigPath(...)` (line 145). T2 replaces the chain of `if`s with a typed dispatch table keyed on `kind`. Preserve the MCP filter call site — see §0.5 item 5.
- **new:** `schemas/install-plan.schema.json` — canonical plan output:

```json
{
  "tool": "ecc",
  "version": "<repo version>",
  "profileId": "...",
  "target": "...",
  "scope": "...",
  "modules": ["..."],
  "operations": [
    { "kind": "copy", "moduleId": "...", "source": "...", "destination": "...",
      "ownership": "managed", "overwritePolicy": "replace" }
  ],
  "conflicts": [
    { "destination": "...",
      "reason": "file-exists | outside-allowed-root | unmanaged-file | profile-conflict | mcp-not-allowed | global-install-blocked",
      "severity": "warning | error",
      "resolution": "..." }
  ],
  "warnings": [],
  "safety": {
    "dryRunRequired": true,
    "globalInstallAllowed": false,
    "mcpAllowed": false,
    "allDestinationsInsideAllowedRoots": true
  }
}
```

- `scripts/lib/install/runtime.js` → wire `buildOperations` into the existing plan/apply flow.

### Tests
- `tests/lib/install/plan-operations.test.js` — per-operation-kind unit coverage.
- `tests/scripts/install-plan-format.test.js` — `--format json` matches `install-plan.schema.json`.
- Deterministic-output test: same inputs → byte-identical JSON.

### Exit Criteria
- Plan schema validates for all profile × target combos.
- `safety` block + `conflicts[]` populated correctly for at least one BLOCK case per `reason`.

---

## Track 3 — Adapter & Path-Safety Hardening (Phase 2)

Split into **T3a (core)** and **T3b (per-adapter)** to keep PR review tractable. T3a defines the contract; T3b fills the per-adapter declarations. Once the contract function signature lands in T3a's helpers.js, T3a and T3b are parallelizable.

### Allowed roots by scope (canonical table — shared by T3a + T3b)

Scoped to the three in-scope targets (claude, codex, opencode). All three are `kind: "home"` adapters today; project-scope rows are kept for completeness against the spec but contain only `./.claude` and `./.codex` which already exist as project-level mirrors for in-repo workflows. Other harness roots are intentionally absent.

| Scope | Roots |
|---|---|
| `sandbox` | `./sandbox/home`, `./sandbox/project`, `./sandbox/state` |
| `project` | `./.claude`, `./.codex` |
| `user` | `~/.claude`, `~/.codex`, `~/.opencode` |

### Track 3a — Path-Safety Core

**Outcomes:** Central path-safety helper; apply-time enforcement on every operation; symlink/traversal escapes rejected with `outside-allowed-root` conflict.

**File deltas:**
- **new:** `scripts/lib/install/path-safety.js` exposing:

```js
function assertInsideAllowedRoot(destination, allowedRoots) { /* ... */ }
function resolveRealPath(p) { /* fs.realpathSync.native with fallback */ }
```

- `scripts/lib/install-targets/helpers.js` (367 lines today) → integrate `path-safety.js` at the existing destination-resolution sites. Concrete touchpoints (verified against the graph):
  - `createManagedOperation({ ... })` — central operation factory; insert assertion before returning the operation.
  - `createRemappedOperation(adapter, moduleId, sourceRelativePath, destinationPath, options)` — assert against the resolved destination.
  - `createNamespacedFlatRuleOperations`, `createFlatFileOperations`, `createFlatRuleOperations` — assert per produced operation.
  - `resolveBaseRoot(scope, input)` — the natural place to surface the scope's allowed-root list.
  - `createInstallTargetAdapter(config)` — wire `allowedRoots(scope)` into the adapter contract; `defaultValidateAdapterInput(config, input)` extends to assert the input scope is supported.
  - **Export:** add `getAllowedRoots(adapter, scope)` that delegates to the adapter (default empty until T3b lands per adapter).
- `scripts/lib/install/apply.js` → call `assertInsideAllowedRoot` on every operation destination immediately before mutation. The existing pre-write logic at `apply.js:120–146` (MCP filter + `.mcp.json` write) is the structural template — the assertion lives in the same pre-write step. **Note:** this file is also touched by T5 (merge-json backups). T3a's call site must land first; T5 wraps the backup logic around it.

**Tests:**
- **new:** `tests/integration/path-safety.test.js` — traversal (`..`), absolute-path escape, symlink escape, denied scope. Asserts `outside-allowed-root` conflict reason fires.

**Exit Criteria:**
- No write executes without passing `assertInsideAllowedRoot`.
- Symlink-escape attack rejected with `outside-allowed-root` conflict.

### Track 3b — Per-Adapter Allowed-Roots Declarations (in-scope adapters only)

**Outcomes:** Each in-scope adapter declares its allowed roots and target kind; T3a's helper consumes them. Out-of-scope adapters keep today's behavior (the new `assertInsideAllowedRoot` only runs against adapters that opt in by returning a non-empty list).

**File deltas (3 adapters, mechanical — single PR):**
- `scripts/lib/install-targets/claude-home.js` → `kind: "home"`, `allowedRoots(scope)` returns claude entries (`~/.claude`, `./.claude`, `./sandbox/home`).
- `scripts/lib/install-targets/codex-home.js` → `kind: "home"`, returns codex entries (`~/.codex`, `./.codex`, `./sandbox/home`).
- `scripts/lib/install-targets/opencode-home.js` → `kind: "home"`, returns opencode entries (`~/.opencode`, `./sandbox/home`; no project-scope mirror today).

**Out of scope for this plan (deferred to v1.1 follow-up track):**
- `cursor-project.js`, `gemini-project.js`, `qwen-home.js`, `antigravity-project.js`, `codebuddy-project.js`, `joycode-project.js` — keep current behavior; T3a's helper falls through to a default no-op for these until they opt in.

**Tests:**
- `tests/lib/install-targets.test.js` → extend with allowlist coverage for the three in-scope adapters; add a guard test that out-of-scope adapters still resolve operations without throwing on the path-safety assertion (i.e., the opt-in semantics work).

**Exit Criteria:**
- Each in-scope adapter returns a non-empty `allowedRoots` for `sandbox` and `user` (claude/codex also for `project`).
- Path-safety integration test (from T3a) passes against real adapter data for claude, codex, opencode.
- Existing tests for the six out-of-scope adapters remain green with no behavior change.

---

## Track 4 — Sandbox Test Harness (Phase 1+2)

### Outcomes
Repeatable apply/uninstall round-trip inside `./sandbox/*`; snapshots lock plan determinism.

### File deltas
- **new:** `tests/fixtures/fake-home/` — minimal `.claude/`, `.codex/`, `.opencode/` skeletons.
- **new:** `tests/fixtures/fake-project/` — project-scope skeleton with one pre-existing unmanaged file (triggers `unmanaged-file` conflict path).
- **new:** `tests/fixtures/conflict-fixtures/` — pre-populated destinations to exercise `file-exists`, `unmanaged-file`.
- **new:** `tests/integration/install-minimal.test.js`
- **new:** `tests/integration/install-developer.test.js`
- **new:** `tests/integration/install-security.test.js`
- **new:** `tests/integration/install-document-ai.test.js`
- **new:** `tests/integration/install-enterprise.test.js`
- **new:** `tests/integration/profile-conflict.test.js` — asserts `profile-conflict` conflict reason fires when a profile lists incompatible modules (e.g., two mutually-exclusive `mcp` modules, or a hook module flagged `riskLevel: high` in a profile with `hook_profile: none`).
- **new:** `tests/integration/round-trip.test.js` — install → snapshot → uninstall → assert baseline equality.
- **new:** `tests/snapshots/{minimal,developer,security,document-ai,enterprise}/install-plan.<target>.json` — canonical plan outputs, one file per in-scope target where the profile supports it.
- `tests/run-all.js` → ensure new files picked up.

### Tests (matrix)
- Profile × target matrix restricted to the **in-scope targets** (`claude`, `codex`, `opencode`) intersected with each profile's declared `targets` list. The five general profiles cover all three targets; `document-ai` and `enterprise` cover `claude` + `codex` only in v1 (opencode deferred to v1.1).
- Assert: no writes outside `./sandbox/*` during any test run (CI guard).

### Exit Criteria
- Matrix green for:
  - `minimal`, `core`, `developer`, `security`, `research` × `{claude, codex, opencode}`
  - `document-ai`, `enterprise` × `{claude, codex}`
- Snapshot diff reviewable on profile change.
- No new integration tests target cursor, gemini, qwen, antigravity, codebuddy, or joycode in this milestone.

---

## Track 5 — Lifecycle Over Typed Operations (Phase 3)

### Outcomes
`uninstall` / `repair` / `doctor` operate on the operation graph, not raw `copy-file` records — and respect `settings.require_audit_log`.

### File deltas
- `schemas/install-state.schema.json` → introduce an `operations[].kind` enum that matches the planner's operation kinds **and** bump `schemaVersion`. Today `kind` is a free-form non-empty string with `additionalProperties: true` on each operation (so old states with `kind: "copy-file"` validate). Adding the enum will reject any non-listed kind, so:
  - Include `"copy-file"` and `"merge-json"` in the enum (existing in-flight states use these — see §0.5 item 1).
  - Bump `schemaVersion` and have the state loader **migrate-on-load** for older states (or downgrade to a soft warn for `schemaVersion < N`). Pick one **explicitly** in the schema PR — the loader is `scripts/lib/install-state.js` + `scripts/lib/state-store/{index,migrations,queries,schema}.js`.
  - Add optional `settings` snapshot (so uninstall knows whether to write audit-log entries).
  - Add optional `backups[]` (per §8 spec, used by the merge-json restore path below).
- `scripts/lib/install-lifecycle.js` → branch by operation `kind`. New canonical mapping (uses existing names where they exist):
  - `copy-file` (existing) / `copy-tree` / `flatten-copy` → delete file/tree.
  - `merge-json` (existing) / `merge-jsonc` → restore from backup (`state.backups[]`).
  - `mkdir` → remove if empty + managed.
  - `remove` → no-op on uninstall.
- `scripts/lib/install/apply.js` → create backups before `merge-json` / `merge-jsonc`; record `backupPath` in state.
- **new:** `scripts/lib/install/audit-log.js` — append-only JSONL writer; profile-gated. Default path by scope:
  - `sandbox`: `<state-dir>/audit.jsonl` (e.g., `./sandbox/state/audit.jsonl`).
  - `project`: `<target-root>/ecc/audit.jsonl` (e.g., `./.claude/ecc/audit.jsonl`).
  - `user`: `<target-root>/ecc/audit.jsonl` (e.g., `~/.claude/ecc/audit.jsonl`).
  - Overridable via `ecc install --audit-log <path>` (only honored when `settings.require_audit_log: true`).
  - No rotation in v1; file appends indefinitely. Rotation deferred to v1.1 (track as follow-up).
- `scripts/install-apply.js`, `scripts/uninstall.js`, `scripts/repair.js` → invoke audit-log when `settings.require_audit_log: true`.

### Tests
- `tests/lib/install-lifecycle.test.js` → extend for each operation kind.
- **new:** `tests/integration/round-trip-merge-json.test.js` — install with merge-json operation, uninstall, assert original file restored byte-for-byte.
- **new:** `tests/lib/audit-log.test.js`.

### Exit Criteria
- Round-trip restores baseline for every operation kind.
- Audit-log produced when and only when `require_audit_log: true`.

---

## Track 6 — Security Defaults & Policy Gates (Phase 2+4)

### Outcomes
Default-deny on high-risk capabilities; profile cannot silently enable them.

### File deltas
- **new:** `scripts/lib/install/policy.js` — enforces:
  - `allow_mcp: false` by default → reject `mcp` modules unless explicitly allowed. **Compose with existing MCP filter** (`scripts/lib/mcp-config.js` provides `filterMcpConfig` and `parseDisabledMcpServers`, already consumed by `scripts/lib/install/apply.js:7,120,145`). Policy decides *whether* a `merge-json` op for `.mcp.json`/`mcp.json` runs at all; the existing filter decides *which servers* survive a permitted merge. Reuse `filterMcpConfig` — do not reintroduce.
  - `allowed_mcp_servers` allowlist enforced when `allow_mcp: true`. Pass the allowlist through `filterMcpConfig` (extend its API if needed) rather than building a parallel filter path.
  - Hook risk classification: `safe | medium | high` (declared per hook in a new field on `manifests/install-modules.json` entries of `kind: "hooks"`, or via a sidecar `manifests/hook-risk.json`).
  - `block_global_install: true` ⇒ refuse `--scope user`.
  - `allow_shell_execution_hooks: false` default.
  - **Interaction with `--with` / `--without`:** the existing `tests/lib/selective-install.test.js` flow lets users add component IDs (e.g., `mcp:context7`) outside of profile membership. Policy runs **after** request normalization (`scripts/lib/install/request.js` + `scripts/lib/install-executor.js`), so a `--with mcp:context7` on a profile with `allow_mcp: false` produces a `mcp-not-allowed` conflict with `severity: "error"` rather than silently dropping the component. Cover this combination in `policy.test.js`.
- `scripts/lib/install/plan-operations.js` → consult policy; emit `conflicts[]` with `severity: "error"` on violation.
- **new:** `scripts/ci/scan-secret-shapes.js` — fail if any committed config matches token shapes (`gh[ps]_[A-Za-z0-9]{20,}`, AWS-key patterns, etc.) outside `${ENV}` placeholders.
- `package.json` scripts → add `"scan:secrets": "node scripts/ci/scan-secret-shapes.js"`.

### Tests
- **new:** `tests/lib/install/policy.test.js` — explicitly exercises `mcp-not-allowed` (allow_mcp:false + mcp module requested) and `global-install-blocked` (block_global_install:true + scope:user) conflict reasons; also covers shell-execution-hook default-deny and hook risk classification.
- **new:** `tests/ci/scan-secret-shapes.test.js` — positive and negative fixtures.

### Exit Criteria
- All v1 profiles pass policy by default with no high-risk capability enabled unintentionally.
- Secret-shape scanner CI gate green.

---

## Track 7 — Promotion Lifecycle & CI Gating (Phase 4)

### Outcomes
A profile cannot be distributed as release-ready without passing the full gate sequence.

### File deltas
- `manifests/install-profiles.json` — **no edits in T7.** The `lifecycle` field lands as part of `settings` in T1 (initial value `"draft"`). T7 transitions values via the gate orchestrator (which writes back through a controlled API, not direct manifest edits in normal flow).
- `scripts/ci/validate-install-manifests.js` → block release if `lifecycle: "promoted"` and any gate output is missing. T7's edits to this file are strictly additive to T1's edits — sequence T7 after T1.
- **new:** `scripts/ci/gate-profile-promotion.js` — orchestrates:
  1. schema validation
  2. plan validation (snapshot match)
  3. sandbox install (integration test runs)
  4. uninstall round-trip
  5. policy / secret-shape scan
- `.github/workflows/*.yml` (if applicable) → add `profile-promotion` job invoking the gate orchestrator. *(Skip if workflows are out-of-scope for this plan; record the gap.)*

### Tests
- **new:** `tests/ci/gate-profile-promotion.test.js` — simulate gate failures (force schema break, force snapshot diff, etc.) and assert the gate refuses promotion.

### Exit Criteria
- Promoted profiles cannot regress without explicit override.
- Gate failure reasons are explicit and actionable.

---

## Track 8 — Operator UX & Docs (Phase 1+ continuous)

### Outcomes
Operators can complete the safe workflow without code edits.

### File deltas
- Update `docs/SELECTIVE-INSTALL-ARCHITECTURE.md` with the safety/profile additions (don't fork — this is the canonical doc). **Do not rename**: `scripts/release.sh` reads this path via `SELECTIVE_INSTALL_ARCHITECTURE_DOC` and `docs/ANTIGRAVITY-GUIDE.md` links it. Renaming requires a coordinated 3-file edit; in-place updates do not.
- Update `docs/SELECTIVE-INSTALL-DESIGN.md` alongside — also linked from `docs/ANTIGRAVITY-GUIDE.md`.
- **new:** `docs/PROFILE-SAFETY-GUIDE.md` — choosing profile by risk, reading plan output, conflict-triage, drift triage.
- `README.md` → "safe first run" section with `ecc plan --profile minimal --target claude --dry-run`.

### Tests
- **new:** `tests/docs/profile-safety-walkthrough.test.js` — assert the documented commands resolve to real CLI flags.

### Exit Criteria
- Fresh-operator walkthrough completes with `ecc plan` + sandbox `ecc install` without source edits.

---

## CLI Surface (concrete delta to `scripts/ecc.js`)

No new commands added. The following **flags** land on existing commands; defaults preserve current behavior.

```
ecc plan      --profile <id> --target <t> [--scope sandbox|project|user]
              [--home <dir>] [--project-root <dir>] [--target-root <dir>] [--state-dir <dir>]
              [--format json] [--dry-run]   # --dry-run is the default for `plan`
              # existing flags preserved: --with <component-id>... --without <component-id>...

ecc install   <existing flags incl. --with / --without> + --scope <s> + --home/--project-root/--target-root/--state-dir
              + --audit-log <path>          # only honored when settings.require_audit_log

ecc uninstall <existing flags> + --state <state.json>

ecc doctor    <existing> + --settings-drift   # reports drift from recorded profile settings
ecc repair    <existing> + operation-aware

ecc list-installed  <existing>  # surfaces resolved settings snapshot
```

Existing aliases to preserve: `ecc plan` ↔ `ecc install-plan` (both registered in `scripts/ecc.js` COMMANDS as separate keys pointing to `install-plan.js`). Adding new flags to one must add them to both alias entries.

Existing flag composition (`tests/lib/selective-install.test.js`):
- `--with <id>` and `--without <id>` accept component IDs including `agent:<name>`, `skill:<name>`, and `mcp:<name>` families.
- `--with` may be used **without** `--profile` (standalone-with mode).
- Profile + `--with` + `--without` resolve into a single normalized request before plan operations are built — policy gating (T6) and path safety (T3a) run on the resolved request, so they see the union, not just the profile's declared modules.

Implementation hook: extend the `COMMANDS` registry in `scripts/ecc.js` only if a new sub-script is genuinely needed. Otherwise extend the existing target scripts in place.

---

## Schema Additions Summary

| Schema | Change |
|---|---|
| `schemas/install-profiles.schema.json` | + `targets[]`, + `settings{}` block (10 optional keys) |
| `schemas/install-modules.schema.json` | + optional `installStrategy`, `pathMode`, `ownership`, `riskLevel` (for `kind: "hooks"`), `conflicts[]` |
| `schemas/install-state.schema.json` | + `operations[].kind` enum, + `settings` snapshot, + `backups[]` |
| **NEW** `schemas/install-plan.schema.json` | canonical plan output (operations, conflicts, warnings, safety) |
| **NEW** `manifests/hook-risk.json` | optional sidecar mapping hook IDs to `safe/medium/high` (or fold into `install-modules.json`) |

---

## Cross-Track Quality Gates

- **Determinism:** same inputs ⇒ byte-identical plan JSON (sort keys, stable ordering of operations).
- **Idempotence:** re-apply approved plan ⇒ zero mutations.
- **Reversibility:** every operation kind has a registered uninstall handler.
- **Auditability:** plan / apply / uninstall artifacts traceable to profile id + repo commit (via existing `source.repoCommit` in install-state).
- **Safety defaults:** project-scoped install default; MCP/global/shell-exec hooks off unless explicitly opted in.

---

## Execution Sequence & Parallelism

### Critical Path
`T1 (profile schema) → T2 (typed operations + plan output) → T3a (path-safety core) → T5 (lifecycle over typed ops) → T4 (sandbox + snapshots)`
*(T4 settles last because its snapshots lock the combined output of T1–T3b.)*

### Parallelizable
- T2 and T3b (per-adapter declarations) can run in parallel once T3a's `getAllowedRoots` contract is published.
- T6 (policy + secret scan) starts as soon as T1 settings are landed.
- T7 (promotion gating) lands strictly **after** T1 (validator file is shared) and after T6 (gate orchestrator invokes secret scan).
- T8 (docs) trails T2/T4 by one sprint.

### Hard sequencing constraints (parallel-wave hazards)
| File | First track | Second track | Reason |
|---|---|---|---|
| `scripts/lib/install/apply.js` | T3a (call `assertInsideAllowedRoot` before write) | T5 (wrap merge-json backup logic around the write) | T5 wraps T3a's guard — must not parallelize |
| `scripts/ci/validate-install-manifests.js` | T1 (semantic checks on `settings`) | T7 (block promoted-without-gates) | T7 edits are additive on top of T1 — sequence, do not parallelize |
| `scripts/lib/install/plan-operations.js` | T2 (creates) | T6 (consumes via `policy.js`) | T6 imports from T2 — natural dependency, not a conflict |

### Milestones
- **M1 — Settings Landed:** T1 complete; all 8 profiles validate.
- **M2 — Typed Plan Ready:** T2 + schema; deterministic snapshots green.
- **M3 — Path-Safe Adapters:** T3a + T3b complete.
- **M4 — Sandbox Matrix Green:** T4 matrix passes for v1 profiles.
- **M5 — Reversible Lifecycle:** T5 round-trip green for all operation kinds.
- **M6 — Policy-Hardened:** T6 default-deny enforced; secret scanner in CI.
- **M7 — Promotion Gated:** T7 active; promoted profiles can't regress.
- **M8 — Operator Ready:** T8 walkthrough green.

---

## MVP Cut (subset of the v1 plan above)

If pressed for time, ship in this order:

1. **MVP profiles:** `minimal`, `developer`, `document-ai` (augment existing + add new).
2. **MVP targets:** `claude`, `codex` (already supported, snapshot-locked first).
3. **MVP features:** T1 + T2 + T4 + T3a (path-safety core for sandbox scope) + minimum T3b (only `claude-home.js` + `codex-home.js` adapters declare roots — opencode lands in the v1 cut, not MVP) + T5 (copy-file + merge-json only).
4. **Deferred to v1 (post-MVP, same plan):** `opencode-home.js` allowedRoots, `opencode` snapshot fixtures for the five general profiles, T6 default-deny policy, T7 promotion gating, T8 docs.
5. **Deferred to v1.1 (separate follow-up plan):** secondary-harness rollout (cursor, gemini, qwen, antigravity, codebuddy, joycode), T6 hook-risk classification, `enterprise` profile broader rollout, MCP allowlist beyond `["context7","github"]`, `flatten-copy` / `render-template` operations.

---

## Acceptance Criteria

```
[ ] All 8 profiles validate against extended schema.
[ ] `ecc plan --profile <p> --target <t> --format json` matches install-plan.schema.json for every supported combo.
[ ] Plan output is deterministic (byte-identical on repeat runs).
[ ] Every destination path passes assertInsideAllowedRoot before any write.
[ ] No test in tests/integration/ writes outside ./sandbox/*.
[ ] Install → uninstall round-trip restores fixtures byte-for-byte (all op kinds).
[ ] Profiles with require_audit_log: true produce audit-log entries; others don't.
[ ] allow_mcp: false rejects mcp modules; allow_mcp: true + allowlist enforced.
[ ] block_global_install: true refuses --scope user.
[ ] Secret-shape scan rejects literal tokens; ${ENV} placeholders pass.
[ ] Promotion gate refuses to mark a profile "promoted" with any failing prerequisite.
[ ] Snapshot diffs make profile changes reviewable in PRs.
[ ] All existing tests in tests/lib/install-*, tests/scripts/install-* remain green.
```

---

## Open Questions (flag before T2 lands)

1. Do we host hook risk levels in `install-modules.json` (`riskLevel` field per hook entry) or as sidecar `manifests/hook-risk.json`? Recommendation: in-module, single source of truth.
2. Should `--scope sandbox` be the default for CI runs (env-detected) to prevent accidental real writes during local test runs? Recommendation: yes, gate on `process.env.NODE_ENV === 'test' || process.env.CI`.
3. Does `enterprise` profile need a distinct adapter (different state-path convention, mandatory audit-log location) or does augmenting existing adapters suffice? Recommendation: augment first; revisit if compliance demands a separate adapter.
4. Should `document-ai` ship as a new `kind: "extraction"` module type, or compose from existing module kinds (`agents-core` + new `data-governance` rules + new validation hooks)? Recommendation: compose.
5. ~~**Trae:** out of scope for v1 (see In-Scope Targets). Trae's existing test stays as-is; no new adapter in this plan.~~ **Resolved.**
6. **Operation-kind name convergence:** the spec uses `"copy"` for single-file copy but the codebase emits `"copy-file"`. Do we (a) keep `"copy-file"` as the canonical kind (and update the spec's wording in T8), or (b) rename to `"copy"` with a state-loader migration? Recommendation: (a) — the migration risk on existing install-state files is not justified by aesthetic alignment.
7. **install-state schema migration policy:** T5's new `operations[].kind` enum will reject any state file written with a kind not in the enum. Pick: (a) bump `schemaVersion` and migrate-on-load via `scripts/lib/state-store/migrations.js`, or (b) keep the enum as a soft-warn under the current `schemaVersion`. Recommendation: (a), since the state file format is already versioned and `migrations.js` exists.
