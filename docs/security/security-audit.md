# Security Audit: Telemetry, External Logging, Injection, and Privilege Risk

Date: 2026-05-19

Scope: local source review of the everything-claude-code (ECC) plugin —
hooks (`hooks/`, `scripts/hooks/`), install machinery (`scripts/install-*.js`,
`scripts/lib/install/`), shared libs (`scripts/lib/`), MCP configs
(`mcp-configs/`), CI workflows (`.github/workflows/`), and a spot-check of
agents/skills/commands markdown. No dependency CVE scan, no dynamic analysis,
no fuzzing.

Sibling document: `docs/security/supply-chain-incident-response.md` covers the
incident playbook; this audit covers the standing posture.

## Executive Summary

ECC is a **client-side plugin** installed into a developer's `~/.claude/`. It
has no server, no database, no web frontend. The relevant attack surface is:

1. What the install scripts do on a developer's machine
2. What the hook scripts do when triggered by Claude Code events
3. What MCP servers ECC recommends spawning
4. What content (agents, skills, commands) gets fed to Claude

**Posture: solid.** No SaaS analytics, no off-machine log shipping, no
elevated-privilege requirements, parameterised SQL only, path-traversal
protection in the hook runner, CI hardened with SHA-pinned actions and
`npm ci --ignore-scripts`, dependency surface limited to three runtime
packages (`@iarna/toml`, `ajv`, `sql.js`).

**One MEDIUM-severity finding** (unsanitised package-manager interpolation
into a `bash -lc` string in the GitHub MCP bootstrap) and a handful of
LOW-severity defense-in-depth gaps (unbounded log growth, no schema-bound
JSON validation on hook stdin, Unicode-normalisation gap in path filtering).

This audit found **no** evidence of:

- Hidden third-party analytics (Sentry, PostHog, Segment, Datadog, OTel,
  GA, etc.)
- Off-machine log shipping
- Use of `eval`, dynamic-code constructors, `vm.runIn*`, or unsafe YAML
  loaders in scripts
- SQL injection (sql.js with bound parameters throughout)
- Install scripts requiring `sudo` or system-path writes
- Use of `pull_request_target` with untrusted checkout in CI

## Findings

### Pillar 1 — Telemetry

#### 1.1 No third-party analytics emitters detected (INFO)

Repository-wide grep across `scripts/`, `hooks/`, `src/`, `ecc2/`,
`plugins/`, and `.github/workflows/` for `sentry`, `posthog`, `mixpanel`,
`amplitude`, `segment`, `datadog`, `gtag`, `umami`, `plausible`, `fathom`,
`opentelemetry`, `statsd`, `prometheus`, `google-analytics` returned zero
matches.

`package.json` declares only three runtime deps: `@iarna/toml`, `ajv`,
`sql.js`. None are HTTP clients; the repo has no `axios`, `got`, `undici`,
or other transport library.

**Risk:** None observed.

#### 1.2 "Metrics" subsystem is local-only (INFO)

ECC writes two metric streams to the user's home directory, both for the
user's own consumption:

- `~/.claude/metrics/costs.jsonl` — per-session token/cost summary
  (Evidence: `scripts/hooks/cost-tracker.js:7`, write at line `:150`)
- `~/.claude/metrics/tool-usage.jsonl` — sanitised per-tool invocation log
  (Evidence: `scripts/hooks/session-activity-tracker.js:6`, write at
  line `:602`)

These files are never read or transmitted by ECC code. Risk: low; see
Pillar 2 for the growth-cap gap.

### Pillar 2 — External Logging

#### 2.1 All logs are local; nothing shipped off-machine (INFO)

All `appendFile` / `writeFile` callers in `scripts/hooks/` target paths
under `~/.claude/` (`getClaudeDir()` from `scripts/lib/utils.js`). No
`fetch`, `https.request`, or transport-library import in any hook script.

#### 2.2 Hook logs grow unbounded (LOW)

Three append-only logs lack any rotation or size cap:

- `~/.claude/metrics/costs.jsonl` — `scripts/hooks/cost-tracker.js:150`
- `~/.claude/metrics/tool-usage.jsonl` —
  `scripts/hooks/session-activity-tracker.js:602`
- `~/.claude/ecc-metrics/compaction.log` —
  `scripts/hooks/pre-compact.js:30`

**Risk:** Heavy users accumulate megabytes/day. Not an exploit path; a
DoS-via-disk-fill is possible only for an attacker who already has hook
execution (i.e., is already on the box).

**Fix:** add an opt-in `ECC_METRICS_MAX_BYTES` rotation hook in
`scripts/lib/utils.js` `appendFile`, or document `logrotate(8)` recipes
in `docs/`.

#### 2.3 Tool-argument logging redacts secrets but uses substring matching (LOW)

`scripts/hooks/session-activity-tracker.js` truncates each tool param to
~160 chars and applies a regex redaction pass for AWS keys, GitHub PATs,
`Authorization:` headers, and other obvious patterns before writing to
`tool-usage.jsonl`.

**Risk:** The redaction list is curated; novel secret formats (custom
internal tokens, JWT bodies, signed URLs) slip through. The 160-char
truncation is the actual mitigation that matters — and it caps blast
radius.

**Fix:** maintain the redaction regex list and treat it as best-effort
defence; the truncation is the load-bearing control.

#### 2.4 Governance capture is opt-in and stderr-only (INFO)

`scripts/hooks/governance-capture.js:255` gates the entire hook behind
`ECC_GOVERNANCE_CAPTURE=1`. When enabled, it writes JSON events to stderr
(line `:133`) — never to disk, never to network.

### Pillar 3 — Injection

#### 3.1 Unsanitised package-manager interpolation into `bash -lc` (MEDIUM)

`scripts/codex/merge-mcp-config.js:70` constructs the GitHub MCP bootstrap
command by interpolating `${PM_EXEC}` directly into a shell string:

```js
const GH_BOOTSTRAP = `token=$(gh auth token 2>/dev/null || true); ...
  exec ${PM_EXEC} @modelcontextprotocol/server-github`;
```

`PM_EXEC` (line `:61`) is the resolved package-manager exec command (e.g.
`"pnpm dlx"`, `"npx"`, `"bunx"`, `"yarn dlx"`). It is then fed to
`bash -lc` via the spawn config at line `:99`. If detection logic ever
returns a value with shell metacharacters — through a manipulated
`pmConfig`, a compromised package-manager wrapper, or a user shell hook
that rewrites the resolution — the metacharacters execute in the MCP
server's shell context every time Codex restarts the GitHub MCP server.

**Trigger:** local-environment compromise of the package-manager
detection pipeline. Not reachable from a model prompt, but elevation
path for an attacker who has limited shell access to set arbitrary env
vars or hook into `which`/`npm config`.

**Fix:** either (a) split `PM_EXEC` into argv and invoke without `bash
-lc` (mirror the `dlxServer` pattern at lines `:78-83` which uses an
arg array), or (b) `shell-quote`-style escape the interpolated value
before embedding.

Severity rationale: MEDIUM not HIGH because the attacker must already
hold local code execution on the box; the gap is an elevation/persistence
gadget, not a primary entry point.

#### 3.2 Hook input is parsed but not schema-validated (LOW)

`scripts/hooks/run-with-flags.js:90-100` and individual hooks
(`session-activity-tracker.js:599` etc.) call `JSON.parse(raw)` on
stdin and fall back gracefully on parse failure. There is no
depth/size cap, no AJV schema check.

**Risk:** Theoretical only — Claude Code (the only producer of this
stdin) is trusted. A malformed or adversarially-shaped payload could
trigger expensive object traversal in downstream hooks but not RCE.

**Fix:** add a top-level depth limit (e.g., `JSON.parse` reviver that
throws past 32 levels) in the shared `run-with-flags.js` parser. Cheap,
defence-in-depth.

#### 3.3 Path traversal protection in place for hook script resolution (INFO — positive control)

`scripts/hooks/run-with-flags.js:107`:

```js
if (!scriptPath.startsWith(resolvedRoot + path.sep)) {
  process.stderr.write(`[Hook] Path traversal rejected ...`);
  process.exit(0);
}
```

Confirmed working: any hook config attempting to resolve a script
outside `pluginRoot` is rejected and the hook is treated as a no-op.

#### 3.4 No dynamic-code constructors or unsafe YAML found (INFO)

Grep across `scripts/` returns no `eval(`, no dynamic-code-constructor
invocations, no `vm.runInContext`, no `yaml.load(` without explicit
safe-schema. JSON parsing uses `JSON.parse` throughout. Markdown is
never rendered to HTML by any script.

#### 3.5 Unicode-normalisation gap in URL filter (LOW)

`scripts/hooks/session-activity-tracker.js:102-116` filters URLs out
of logged params using literal-prefix regex (`/^https?:/i`, etc.).
A path or string using Cyrillic or full-width lookalikes bypasses the
filter and reaches the tool-usage log.

**Risk:** Very low. URLs in tool args are not themselves secrets; the
filter is privacy-hygiene, not a security boundary. Bypass leaks a URL
to the user's own local log file.

**Fix:** NFKC-normalise the param before filtering, or accept the
filter as best-effort and document accordingly.

#### 3.6 Prompt-injection vectors in agent/skill markdown (INFO)

Spot-check of `agents/`, `skills/`, `commands/` did not find any agent
that instructs Claude to "fetch URL X and execute its contents" without
trust-boundary framing. The `CLAUDE.md` Prompt Defense Baseline (lines
9-15) is replicated into rule files and instructs Claude to treat
external, fetched, and user-provided content as untrusted.

**Risk:** Prompt-injection resistance depends on Claude honouring those
instructions; ECC ships the guardrails but cannot enforce them at the
runtime layer.

**Fix:** out of scope here; tracked by `agents/` and `rules/`
maintenance.

### Pillar 4 — Privilege

#### 4.1 Install scripts are user-scoped only (INFO — positive control)

`scripts/install-plan.js` and `scripts/install-apply.js` write to
`plan.targetRoot`, which resolves to one of: a project-local path, the
user's `~/.claude/`, or another user-owned IDE config directory. Policy
rule R3 in `scripts/lib/install/policy.js` rejects `scope:user` requests
when `block_global_install:true`.

No `sudo`, no `process.getuid()` check, no writes to `/etc/`, `/opt/`,
`/usr/local/`, or other root-owned paths in any script.

#### 4.2 Hook timeouts and non-blocking failures (INFO — positive control)

`scripts/hooks/run-with-flags.js:168` enforces a 30-second timeout on
legacy spawned hooks. All `scripts/hooks/*.js` use try/catch with
`process.exit(0)` fallback paths so a hook crash never blocks Claude
Code tool execution (per `.claude/rules/node.md`: "All hooks must exit
0 on non-critical errors").

#### 4.3 MCP server configurations use arg arrays (INFO — positive control)

`scripts/codex/merge-mcp-config.js:78-83` (`dlxServer` helper) builds
MCP configs with `args: [...PM_EXEC_PARTS.slice(1), pkg]` — an array,
spawned without shell interpretation. Safe by construction.

The exception is the GitHub MCP server, which deliberately uses bash
for token forwarding (see 3.1 above for the resulting MEDIUM finding).

#### 4.4 CI workflow is hardened (INFO — positive control)

`.github/workflows/ci.yml`:

- `permissions: contents: read` (line `:16-17`) — minimal scope
- All third-party actions pinned by SHA (`@de0fac2e...`, `@53b83947...`,
  `@043fb46d...`)
- `npm ci --ignore-scripts` on every job — blocks postinstall scripts
- No `pull_request_target` event; PRs check out via standard
  `pull_request` event so untrusted PR code never runs with write
  permissions
- No `secrets:` block — workflow has no secret access

#### 4.5 No bundled git hooks modify user repos (INFO)

`scripts/codex-git-hooks/` exists but is opt-in and writes into the
target project's `.git/hooks/` only when explicitly invoked by a user
command. Not auto-installed.

#### 4.6 MCP servers are recommended, not auto-installed (INFO)

`mcp-configs/mcp-servers.json` is a config template referenced by
documentation. ECC does not automatically register MCP servers into a
user's Claude Code; users opt in by running the install command and
reviewing the resulting MCP config diff.

## Top 5 Prioritized Issues

| # | Severity | Issue | Effort |
|---|---|---|---|
| 1 | MEDIUM | `merge-mcp-config.js:70` interpolates `${PM_EXEC}` into a `bash -lc` string for the GitHub MCP bootstrap. Fix by splitting into argv. | small |
| 2 | LOW | Three metric/log files (`costs.jsonl`, `tool-usage.jsonl`, `compaction.log`) grow unbounded with no rotation policy. Add an opt-in cap. | small |
| 3 | LOW | Hook stdin JSON parsing has no depth/size cap. Add a reviver-based depth limit in `run-with-flags.js`. | trivial |
| 4 | LOW | URL filter in `session-activity-tracker.js:102-116` uses literal-prefix regex; Unicode lookalikes bypass. NFKC-normalise first. | trivial |
| 5 | LOW | Tool-argument secret redaction is regex-based and may miss novel token formats; the 160-char truncation is the load-bearing control. Document this in `SECURITY.md` so the redaction list isn't mistaken for a guarantee. | docs only |

## What's Good (Don't Paper Over These)

- **Minimal runtime dependency surface.** Only three packages
  (`@iarna/toml`, `ajv`, `sql.js`). No HTTP client. Drastically reduces
  supply-chain blast radius.
- **Local-only data architecture.** All metrics, logs, audit trails
  written under `~/.claude/`. Zero off-machine transmission.
- **CI is genuinely hardened.** Minimal `permissions:` block, SHA-pinned
  actions, `--ignore-scripts` on every `npm ci`, no `pull_request_target`.
- **Path traversal protection in the hook runner** (`run-with-flags.js:107`).
- **MCP configs use arg arrays** in `dlxServer` — safe by construction.
- **Hooks fail open and non-blocking.** A crashing hook never blocks
  Claude Code. Enforced by `.claude/rules/node.md` and observed in code.
- **Parameterised SQL throughout** the `scripts/lib/state-store/`
  surface. No string-concatenation queries.
- **Explicit redaction pass** for AWS keys, GitHub PATs, Authorization
  headers in tool-arg logging — even though it's regex-based, the
  intent is right and it composes with the 160-char truncation.

## Remediation Plan

### Phase 0 — User-side hardening (no code change)

For users running ECC with elevated risk tolerance:

1. Set `ECC_GOVERNANCE_CAPTURE=0` (default) unless actively debugging.
2. Periodically rotate `~/.claude/metrics/*.jsonl` (e.g., monthly cron).
3. Treat ECC plugin updates as untrusted code review surface — read the
   diff of `mcp-configs/`, `scripts/hooks/`, and `scripts/install-*.js`
   before pulling.

### Phase 1 — Code fixes (small, high-leverage)

1. **Fix `merge-mcp-config.js:70`** — split `PM_EXEC` into argv, drop
   `bash -lc` where possible. If bash is required for `gh auth token`
   piping, quote the interpolation explicitly.
2. **Add metric-log rotation** — in `scripts/lib/utils.js` `appendFile`,
   honour an `ECC_METRICS_MAX_BYTES` env var; rotate via simple rename
   when exceeded.
3. **Cap hook-stdin JSON depth** — pass a depth-tracking reviver to
   `JSON.parse` in `scripts/hooks/run-with-flags.js`. Reject past N=32.
4. **NFKC-normalise the URL filter** in
   `scripts/hooks/session-activity-tracker.js:102` before applying
   `/^https?:/i`.

### Phase 2 — Documentation and test gates

1. **Document the redaction-vs-truncation distinction** in
   `SECURITY.md`: redaction is best-effort, truncation is the
   load-bearing control. Tells future contributors what to preserve.
2. **Add unit test for `merge-mcp-config.js` PM_EXEC handling** —
   assert that a `pmConfig` with shell metacharacters never produces
   a vulnerable bash string.
3. **Add unit test for the path-traversal rejection** in
   `run-with-flags.js`. Regression-protect the existing positive
   control.
4. **CI: `npm audit --audit-level=high`** is already present per
   `ci.yml:120-121` — keep it on, surface failures publicly.

### Phase 3 — Recurring hygiene

1. Re-run this audit on a meaningful change to: any file in
   `scripts/hooks/`, `mcp-configs/`, `scripts/install-*.js`,
   `scripts/lib/install/`, `.github/workflows/`.
2. Refresh action SHA pins quarterly; verify against published action
   releases.
3. Track the `package.json` runtime deps closely — adding a fourth
   runtime dependency is a posture change worth discussing in PR.

## Bottom Line

ECC has the security posture of a careful, narrowly-scoped client-side
plugin: no covert telemetry, no remote logging, no privileged
operations, minimal dependencies, hardened CI. The single MEDIUM
finding is a contained shell-interpolation gadget reachable only after
local compromise; the LOWs are defense-in-depth and hygiene gaps.

The meaningful security work is the small cluster of fixes in Phase 1
(maybe one focused PR), plus the documentation discipline in Phase 2
to keep the posture coherent as the surface grows. There is no
emergent risk requiring rollback or pause.
