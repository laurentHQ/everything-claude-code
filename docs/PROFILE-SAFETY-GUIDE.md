# Profile Safety Guide

This guide walks an operator from a fresh checkout to a verified install
without source edits.

## Choosing a profile

| Profile | Use when |
|---|---|
| `minimal` | Lowest-risk baseline. No hooks runtime, no MCP. Good for read-only sandbox exploration. |
| `core` | Adds the hooks runtime to `minimal`. Default starting point. |
| `developer` | `core` plus framework/language/database/orchestration modules. The everyday engineer profile. |
| `security` | `core` plus the `security` module. Strict hook profile, no MCP, refuses global install. |
| `research` | `core` plus research-apis/business-content/social-distribution. No MCP unless overridden. |
| `document-ai` | Validation hook profile, audit log required. Targets `claude` and `codex` only in v1. |
| `enterprise` | Strict hooks, MCP allowed (allowlist of `context7` and `github`), audit log required. |
| `full` | Every module. Use only when you have read every operation in the plan. |

## Safe first run

1. **Plan first, install second.** Always inspect the plan before applying:
   ```
   node scripts/install-plan.js --profile minimal --target claude --json
   ```
   The output is a JSON document matching `schemas/install-plan.schema.json`.
   Inspect `operations`, `conflicts`, `safety`, and `warnings`.

2. **Read the `safety` block.** Four booleans summarize the install:
   - `dryRunRequired` — caller is expected to run `--dry-run` first
   - `globalInstallAllowed` — false means `--scope user` is refused
   - `mcpAllowed` — false means any MCP module/component triggers refusal
   - `allDestinationsInsideAllowedRoots` — false means the adapter rejected a destination

3. **Triage conflicts.** Any `conflicts[]` entry with `severity:"error"` will
   refuse the install. See the conflict triage table below.

4. **Apply.** Once the plan is clean, run the corresponding `ecc install`
   command with the same flags.

5. **Verify.** `ecc doctor` reports drift, missing files, and unmanaged content.
   Use `ecc repair` to restore drifted files (but read the diff first — repair
   refuses to overwrite parse-error destinations, see `parse-error` below).

## Conflict triage

| `reason` | What it means | How to resolve |
|---|---|---|
| `mcp-not-allowed` | Profile has `allow_mcp:false` (or you requested a server outside `allowed_mcp_servers`). | Switch to a profile that allows MCP, OR remove the offending `--with mcp:*` flag, OR add the server to `allowed_mcp_servers` if the profile owner agrees. |
| `global-install-blocked` | Profile has `block_global_install:true` and you used `--scope user`. | Re-run with `--scope project` or `--scope sandbox`. |
| `hook-risk-high` | Profile has `hook_profile:"validation"` and a selected hooks module is classified `riskLevel:"high"`. | Use a profile without the validation gate, OR ask the hook module author to downgrade `riskLevel` if appropriate. |
| `outside-allowed-root` | A destination resolves outside the adapter's `allowedRoots`. | Check the `HOME` env var and the `--scope` flag (the adapter derives its allowed roots from those). A symlink anywhere in the destination path that resolves outside the allowed-root tree also fires this conflict. |
| `file-exists` / `unmanaged-file` / `profile-conflict` | (Reserved for future cycles; not yet emitted by the planner in v1.) | n/a |

## Drift triage (`ecc doctor`)

The inspector returns one of:

- `managed` — file matches the recorded source byte-for-byte
- `drifted` — file content differs from the recorded source
- `missing` — file was recorded but is gone
- `parse-error` — destination is JSON but no longer parseable (do NOT auto-repair; surface the parse error)
- `permission-error` — destination cannot be read due to permission/handle issues (investigate before any other action)
- `unmanaged` — file present in the install path but not in the recorded operations

## Promotion lifecycle

Profiles carry a `settings.lifecycle` value: `draft | candidate | promoted`. A
profile cannot be marked `promoted` without a passing `gates-report.json`
produced by `scripts/ci/gate-profile-promotion.js`. Use:

```
node scripts/ecc-promote.js <profileId> --to candidate
node scripts/ecc-promote.js <profileId> --to promoted
```

`--force` is required for backwards transitions (`promoted → candidate`). The
CI workflow `.github/workflows/profile-promotion.yml` runs the gate orchestrator
on every PR that touches profile/policy/scanner code.

## See also

- `docs/PROFILE-LIMITATIONS.md` — exhaustive map of what is and isn't enforced in v1
- `docs/SELECTIVE-INSTALL-ARCHITECTURE.md` — system architecture for `ecc install`
- `docs/SELECTIVE-INSTALL-DESIGN.md` — design rationale
