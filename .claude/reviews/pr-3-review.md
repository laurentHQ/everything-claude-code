# PR #3 Review — `feature/profiles-deploy-v1` (V1 implementation)

**PR:** https://github.com/laurentHQ/everything-claude-code/pull/3
**Range reviewed:** `687ef8ff..bf46bff6` (5 implementation commits — W0/W1/W2/W3/W4; excludes V1.1 plan commit `20e441be`)
**Reviewed:** 2026-05-17
**Method:** 5 parallel specialized agents from `pr-review-toolkit` — code-reviewer, pr-test-analyzer, silent-failure-hunter, type-design-analyzer, comment-analyzer
**Test baseline:** 2689/2689 passing

---

## Verdict

**Recommend: PATCH — fix the 3 cross-cutting critical issues before merge.** Two of them have the same root cause (scope plumbing), one is a documentation lie, one is dead defense-in-depth code. None of the criticals are conceptually hard; total fix surface is ~50–100 lines plus a snapshot regeneration.

**The plan-review skill's "Layer 0 — Spec Alignment" check would have caught Critical #1 and #3 before W2 even shipped.** Worth running plan-review on the V1.1 plan before Wave 0 of that cycle.

---

## Critical (block merge — but each is small)

### C1 — `scope` is never plumbed through `buildPlanDocument` → R3 conflict cannot fire in snapshots OR in CI promotion gate
**Source:** code-reviewer C1 (confidence high), corroborated by comment-analyzer (CLI flag claim that contradicts code)
**Files:** `scripts/install-plan.js:288`, `scripts/lib/install/policy.js:73`, `scripts/ci/gate-profile-promotion.js:49`

`buildPlanDocument(plan, adapter, { scope: null, ... })` — hardcoded. `resolveInstallPlan` never populates `scope`. Policy R3 reads `resolvedRequest.scope || settings.scope || null`; for profiles like `security` (`block_global_install:true` + `settings.scope` not set), the rule simply cannot fire from any document-building path. **The 19 install-plan snapshots are blind to scope-based blocking.** The CI promotion gate's `gatePolicyClean` (gate-profile-promotion.js:49) loops profiles WITHOUT iterating over scopes, so even the gate doesn't catch a regression.

**Why this matters:** the entire premise of V1 was that `block_global_install:true` becomes runtime-enforced. It IS — but only via the CLI argv path in `install-apply.js`. No other surface validates it. A v1.1 refactor that drops the CLI's explicit `evaluatePolicy(..., scope: parsedArgs.scope)` call (line 151–159) would silently regress the contract.

**Fix:** Two pieces:
1. Plumb `scope` through `resolveInstallPlan` → `resolvedRequest` → `buildPlanDocument`.
2. `gatePolicyClean` iterates `for (const scope of ['user', 'project', 'sandbox'])` per profile.

Regenerate snapshots after the fix — they'll diff for `security` × `claude/codex/opencode` × `user` (which would now contain a `global-install-blocked` conflict).

### C2 — Executor "defense-in-depth" gate is dead code
**Source:** code-reviewer C2, silent-failure-hunter I2
**File:** `scripts/lib/install-executor.js:130–139`

```js
if (plan && Array.isArray(plan.conflicts) && plan.conflicts.length > 0) { ... }
```

`plan` here is `createManifestInstallPlan`'s output — a raw operation list with no `conflicts` field. The gate is structurally unreachable. The "two-gate" claim in T6's commit message (and propagated to the status file) is in practice **one gate**: only `install-apply.js:151–159`'s explicit `evaluatePolicy + assertNoBlockingConflicts` enforces refusal. Any future programmatic caller invoking `applyInstallPlan` outside the CLI inherits zero policy enforcement.

**Fix:** Either
- (a) `applyInstallPlan` calls `evaluatePolicy(plan, plan.profileSettings)` unconditionally, OR
- (b) require callers to attach a precomputed policy result and throw if absent.

Option (b) preserves the current separation; option (a) makes the executor self-contained. Pick one.

### C3 — Operator docs document a `--scope` CLI flag that doesn't exist in `install-apply.js` / `install-plan.js`
**Source:** comment-analyzer (Critical)
**Files:** `README.md:213`, `docs/PROFILE-SAFETY-GUIDE.md:30,49`

```
node scripts/install-apply.js --profile minimal --target claude --scope sandbox
```

`install-apply.js` does not parse `--scope` from argv (only consumes `options.scope` later). An operator running the documented command gets silently incorrect behavior — `--scope sandbox` is ignored, the install runs against the user scope, and the `block_global_install:true` rule that should have fired… also doesn't fire (see C1). The two criticals compound: C1 means the rule can't fire even if scope WERE supplied; C3 means the operator can't even supply it.

**Fix:** Same root cause as C1. Once scope is plumbed through, also add argv parsing to `install-apply.js` + `install-plan.js`. Anti-rot test should be extended to actually invoke `--help` on the CLI and assert documented flags appear in the help text.

### C4 — `docs/SELECTIVE-INSTALL-ARCHITECTURE.md` lists the WRONG 5 gates
**Source:** comment-analyzer (Critical)
**File:** `docs/SELECTIVE-INSTALL-ARCHITECTURE.md:813–815`

Doc claims the gates are: schema validation, semantic checks, snapshot conformance, policy unit tests, secret-shape scanner. **Actual `gate-profile-promotion.js:89` gates are:** `schema`, `snapshot`, `policy`, `secret-scan`, **`round-trip`**. The doc invents a "semantic checks" gate (it's folded into the schema gate via `validate-install-manifests.js`) and OMITS the `round-trip` gate (which actually runs).

**Fix:** Rewrite the paragraph with the actual gate list. Cross-reference `scripts/ci/gate-profile-promotion.js`. Anti-rot test should be extended to parse the gate names from the doc and assert they exist in `gate-profile-promotion.js`'s `runGates` array.

---

## Important (should fix in V1.1 or shortly after merge)

| ID | Source | Topic | Action |
|---|---|---|---|
| I1 | silent-failure C1 | `gate-profile-promotion.js` `runChildScript` — `result.status === null` (spawn crash, signal kill) is silently treated as "fail with empty detail" | Surface `result.error.message` + `result.signal`; treat `status: null` distinctly |
| I2 | silent-failure C2 | `audit-log` try/catch scope creep — wraps adapter access + settings access; TypeError from malformed plan reported as "audit-log failure" (misleading) | Narrow try-block to ONLY `maybeAppendAuditEvent` call |
| I3 | code-review I1 | `ecc-promote` is non-atomic — concurrent calls can clobber | `writeJsonFile` writes to `${path}.tmp` then `fs.renameSync` |
| I4 | code-review I2 + silent-failure I6 | Secret scanner placeholder allowlist suppresses ENTIRE line, not just the placeholder span | Check whether matched span is INSIDE a placeholder span, not whether the line contains one |
| I5 | code-review I3 + silent-failure I6 | JSONC stripper silently corrupts strings containing `//` | Either pull in a real JSONC parser or refuse `merge-jsonc` for files with comment-like substrings in strings |
| I6 | code-review I4 + silent-failure I5 | `migrateInstallState` returns unknown schemaVersion unchanged with stderr warning; future v3 client downgrade could silently corrupt state | Throw on unknown schemaVersion; document the migration registration contract |
| I7 | test-analyzer C1 | Gate orchestrator NEVER runs a real sub-gate end-to-end (tests only use stubs) | Add at least one test that drives un-stubbed `runChildScript` against a deliberately-failing fixture script |
| I8 | test-analyzer C3 | `applyInstallPlan` refusal test uses a synthetic plan that bypasses real plumbing; doesn't prove the guard fires BEFORE side effects | Replace with the existing `mcp:context7 + allow_mcp:false` case fed through the real `applyInstallPlan` path; assert no destination file written |
| I9 | test-analyzer C2 | Cross-rule interaction (R1 + R3 + R4 firing together) not tested through real plan path | Add a multi-rule plan fixture |
| I10 | type-design Important | `InspectionStatus` is fully un-schematized — 8 distinct status strings live in `install-lifecycle.js` with no enum anywhere | New `schemas/install-inspection.schema.json` with status enum; runtime guard in `install-lifecycle.js` |
| I11 | type-design Important | `assertNoBlockingConflicts(planLike)` silently no-ops on `null` input — caller that forgot to wire policy thinks everything is fine | Add `if (!planLike) throw` precondition |
| I12 | comment-analyzer Important | `PROFILE-SAFETY-GUIDE.md:51` tells operators to "check `--home` / `--project-root` / `--target-root` flags" that don't exist on install CLIs | Replace with actual env vars / planning-input mechanisms |
| I13 | silent-failure C3 | `executeRepairOperation` doesn't refuse `parse-error`/`permission-error` itself — relies on caller (`repairInstalledStates`) | Add internal guard so future direct callers can't bypass |
| I14 | code-review S2 + silent-failure I7 | `gatePolicyClean` failure detail is JSON-stringified into single field; runner truncates to first line | Print full failure list to stderr before returning |

---

## Suggestions (track in `.claude/plan/<v1.1-plan>` tech-debt section)

| ID | Source | Topic |
|---|---|---|
| S1 | type-design | `LifecycleTransition.reason` and `GateResult` are free-form strings — split into enum reason + message field |
| S2 | type-design | `riskLevel` enum should add `default: "safe"` for self-documentation |
| S3 | test-analyzer S | Anti-rot guard doesn't prove it would have caught the W2 `hook-risk-high` regression (no negative fixture) |
| S4 | test-analyzer | `ecc-promote` CLI test missing `--force` flag coverage |
| S5 | test-analyzer | Snapshot determinism not re-run in-process (would catch a non-determinism source before CI does) |
| S6 | test-analyzer | `remove` round-trip masks state-recording bug; assert install-state JSON contains the operation |
| S7 | silent-failure | `walkFiles` + `scanFile` in secret scanner silently skip unreadable files/dirs |
| S8 | silent-failure | `getPackageVersion` etc. silently return null; add stderr warning |
| S9 | comment-analyzer | `apply.js:131-141` DISPATCH preamble describes `copy-path`/`copy-tree`/`flatten-copy` aliases — will go stale when V1.1 T6 collapses the alias |
| S10 | comment-analyzer | `gate-profile-promotion.js:33-39` `gatePolicyClean` comment contradicts itself ("piggyback" + "direct check") |
| S11 | comment-analyzer | `lifecycle-transitions.js:62-66` claims spread preserves key order "at its existing position" — true when key exists, but appends if absent |
| S12 | code-review S3 | `ecc-promote.js --help` missing exit-code documentation |
| S13 | type-design | Build-time assertion that every `policy.js`-emitted reason is in the schema enum (would have caught the W2 oversight that W4 patched) |
| S14 | silent-failure | `applyTransition` non-atomic — add temp-file-rename pattern in `json-format.js` (same as I3 but applies to all in-place manifest edits) |
| S15 | silent-failure | `migrateInstallState` and `assertValidInstallState` produce duplicate noise (warning + error) — dedupe |

---

## Strengths (positive observations across all agents)

- **`docs/PROFILE-LIMITATIONS.md` enforcement table** — every "enforced" row's `conflicts[].reason` value verified present in the schema enum after W4's `hook-risk-high` patch. Anti-rot test actually runs and catches drift.
- **`policy.js` JSDoc input-shape assertion is honest** — comment says "expected full module objects"; verified the code checks `.id` field (not just `typeof === 'object'`).
- **`migrateInstallState` JSDoc is precise** — verified the code does a pure schemaVersion bump (no other field mutation).
- **`scan-secret-shapes.js` placeholder regexes match correctly** for both `${ENV}` and `${{ secrets.NAME }}` (though the line-level allowlist is too broad — see I4).
- **W0/I8 audit-on/off split is exemplary** — fixes the original filter-mask bug structurally, not by adding an assertion to the masked test. The audit-off variant asserts `listAllFiles(tmp) === []`.
- **`apply-unknown-kind.test.js`** correctly asserts both the throw AND the absence of side effects (no destination file, no install-state file) — this is the pattern I8 wants for the refusal test.
- **`policy.test.js`** has clean positive/negative pairing for all 4 rules + the input-shape assertion + stderr-capture for `assertNoBlockingConflicts`.
- **`lifecycle-transitions.test.js`** covers state-machine completeness at the right granularity (forward, backward-with-force, skip-ahead-with-force, idempotent, unknown source/target).
- **`$ref` extraction (W0/I10)** is exemplary — `install-settings.schema.json` is `additionalProperties: false`, every value an enum or bool. Reduced duplication across state/profiles/plan.
- **All 4 V1-emitted policy reasons** (`mcp-not-allowed`, `global-install-blocked`, `hook-risk-high`, `outside-allowed-root`) are now in the schema enum after the W4 fix. No new offenders introduced by V1 beyond the one W4 patched.
- **Wave commit hygiene** — all 5 implementation commits follow conventional-commit format with clear subject + body.

---

## Type-design ratings (from type-design-analyzer)

| Dimension | Score | Rationale |
|---|---|---|
| Encapsulation | 4/5 | `$ref` extraction is clean and well-bounded |
| Invariant expression | 3/5 | Schemas express the install contract well; lifecycle/inspection/gates still JS-only |
| Usefulness | 4/5 | New types align with real boundaries; one over-permissive helper (`assertNoBlockingConflicts` two-shape acceptance) |
| Enforcement | 3/5 | AJV at plan/manifest boundaries; runtime-only for lifecycle/gates/inspection |

(MVP ratings for reference: 3 / 2 / 4 / 2. V1 improves all four axes.)

---

## Per-agent counts

| Agent | Critical | Important | Suggestions |
|---|---|---|---|
| code-reviewer | 2 | 4 | 3 |
| pr-test-analyzer | 3 | 5 | 4 |
| silent-failure-hunter | 3 | 7 | 4 |
| type-design-analyzer | 2 | 4 | 5 |
| comment-analyzer | 2 | 5 | 3 |
| **De-duplicated total in this report** | **4** | **14** | **15** |

The cross-agent overlap on C1 (scope plumbing) + C2 (dead executor gate) is the strongest signal in the review — three independent agents arrived at the same defect via different paths.

---

## Recommended action plan

1. **Before merge (the 4 criticals — small surface):**
   - **C1 + C3 (combined):** plumb `scope` through `resolveInstallPlan` → `resolvedRequest` → `buildPlanDocument`; add argv parsing for `--scope` in `install-apply.js` + `install-plan.js`; loop scopes in `gatePolicyClean`. Regenerate snapshots. Estimated: 1 hour.
   - **C2:** delete the dead defense-in-depth check OR make `applyInstallPlan` self-enforce by calling `evaluatePolicy` directly. Estimated: 30 minutes.
   - **C4:** rewrite the `SELECTIVE-INSTALL-ARCHITECTURE.md` gate paragraph; extend the anti-rot test to parse gate names from the doc and assert they exist in `gate-profile-promotion.js`. Estimated: 30 minutes.

2. **Bundle the Important set into V1.1 Wave 0** alongside the existing tech-debt cleanup track (T7). I1/I2/I7/I8/I9 are the highest-leverage tightenings; the rest can join the V1.1 plan's tech-debt section.

3. **Suggestion set (S1–S15)** → append to the V1.1 plan's tech-debt rolling log; address opportunistically when adjacent code is being modified.

4. **Re-run plan-review on the V1.1 plan before launching its Wave 0** — would catch the kind of contract-vs-code drift that produced C1 here.

5. **Re-run pr-review-toolkit after applying the 4 critical fixes** to verify no regressions.
