# Profile Settings — MVP Limitations (2026-05-17)

The following profile-settings keys are **stored and schema-validated** by the MVP
but are **NOT enforced at install/apply time**. Runtime enforcement lands in T6.

| Setting | MVP behavior | v1 behavior (T6) |
|---|---|---|
| allow_mcp: false | declared in profile only — installing an mcp module does NOT emit a `mcp-not-allowed` conflict | denied with `conflicts[].reason = "mcp-not-allowed"` |
| allowed_mcp_servers | stored but not consulted at apply time | passes through `filterMcpConfig` allow path |
| block_global_install: true | does NOT refuse `--scope user` | refuses `--scope user` with `global-install-blocked` error |
| hook_profile: "validation" | hooks not classified or filtered | hook risk classification + default-deny on `high` |

The pre-existing `ECC_DISABLED_MCPS` env-filter (parsed at the top of
`applyInstallPlan` in `scripts/lib/install/apply.js` and consumed inside the
`merge-json` and `copy-file` MCP dispatch handlers) continues to apply
unchanged in MVP.

What IS enforced in MVP:

- Schema-level validation of the new `targets[]` and `settings{}` shapes
  via `schemas/install-profiles.schema.json`.
- CI semantic checks in `scripts/ci/validate-install-manifests.js`:
  - `allow_mcp:true` requires non-empty `allowed_mcp_servers`.
  - `block_global_install:true` is incompatible with `scope:"user"`.
  - `hook_profile:"validation"` requires `require_audit_log:true`.
- Read APIs `getProfileSettings(profileId)`, `listInstallProfiles()`, and
  `resolveInstallPlan(...).profileSettings` return cloned settings objects
  so consumers (other tracks) can begin wiring without mutation risk.

Runtime enforcement of the declarative settings above lands in T6 (deny-by-
default policy gate, secret-shape scan, hook risk classification) and T7
(promotion lifecycle / CI gating) — both deferred from the MVP cut.
