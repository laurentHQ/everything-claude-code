# Profile Safety — Limitations (v1)

This page is the canonical "what is and isn't enforced" reference for the ECC
profile-based install system at the current release. Use it to triage why an
install was refused (or unexpectedly allowed) and to understand what work is
deferred.

## What is enforced in v1

| Capability | Enforced via | Conflict reason emitted |
|---|---|---|
| `allow_mcp:false` rejects mcp components or modules targeting `.mcp.json` | `scripts/lib/install/policy.js` Rule 1 + `assertNoBlockingConflicts` in `scripts/install-apply.js` | `mcp-not-allowed` |
| `allow_mcp:true` + `allowed_mcp_servers` allowlist enforced | `scripts/lib/install/policy.js` Rule 2 | `mcp-not-allowed` |
| `block_global_install:true` refuses `--scope user` | `scripts/lib/install/policy.js` Rule 3 | `global-install-blocked` |
| `hook_profile:"validation"` rejects hooks with `riskLevel:"high"` | `scripts/lib/install/policy.js` Rule 4 | `hook-risk-high` |
| `require_audit_log:true` writes append-only JSONL on install + uninstall | `scripts/lib/install/audit-log.js` invoked from `apply.js` + `install-lifecycle.js` | n/a (observable in `<targetRoot>/ecc/audit.jsonl`) |
| `lifecycle:"promoted"` requires passing 5-gate sequence | `scripts/ci/gate-profile-promotion.js` + `validate-install-manifests.js` | n/a (CI-time gate) |
| Schema validation of `targets[]` and `settings{}` | `schemas/install-profiles.schema.json` + shared `install-settings.schema.json` | n/a (schema-time gate) |
| CI semantic checks for impossible setting combinations | `scripts/ci/validate-install-manifests.js` (`runProfileSettingsSemanticChecks`) | n/a (CI-time gate) |
| Path safety on every destination | `scripts/lib/install/path-safety.js` invoked from `apply.js` | `outside-allowed-root` |

## What is deferred to v1.1

| Capability | Reason | Tracking |
|---|---|---|
| `document-ai` and `enterprise` profiles × `opencode` target snapshots | Scope of v1 was the 5 general profiles for opencode | v1.1 plan (when written) |
| Secondary harness adapters (`cursor`, `gemini`, `qwen`, `antigravity`, `codebuddy`, `joycode`) `allowedRoots` + snapshots | Out of scope for the install-safety v1 cut | v1.1 plan |
| Hook risk classification beyond `safe / medium / high` (granular per-hook policy) | v1 ships the three-level enum only | v1.1 plan |
| MCP allowlist values beyond `["context7", "github"]` | Enterprise profile ships with two-server allowlist | v1.1 plan |
| Audit-log rotation | v1 appends indefinitely | v1.1 plan |
| `repair`-time audit-log writing (install + uninstall only in v1) | v1 wired audit-log to two of the three lifecycle paths | v1.1 plan |
| Convergence of `copy-path` / `copy-file` to a single canonical kind name | Two names co-exist via dispatch alias; convergence requires a state-loader migration | v1.1 plan |

## Reading conflict output

When `ecc install` refuses to run, the CLI exits non-zero and emits one
`[policy] refusing install:` line per blocking conflict on stderr. The same
information is visible in the plan document's `conflicts[]` array via
`ecc plan --profile <id> --target <t> --json`. Each conflict carries:

- `reason` — one of the enum values above
- `severity` — `error` blocks; `warning` is informational
- `destination` — the affected component id, path, or scope
- `resolution` — a human-readable suggestion

See `docs/PROFILE-SAFETY-GUIDE.md` for the operator-facing walkthrough.
