# Security Remediation Plan

Companion to: `docs/security/security-audit.md` (2026-05-19)
Date: 2026-05-19
Status: Draft for maintainer review

This plan walks each finding from the security audit through impact reasoning
(who's affected, what breaks if we don't fix, what breaks if we fix wrong),
fix design, verification, and rollback. The goal is to pick fixes whose
benefit clearly exceeds the regression risk they introduce, and to sequence
them so each one is independently reviewable and revertible.

## How to read this doc

Each finding has the same shape:

- **What & where** — restated in one line with file:line
- **Realistic threat model** — who can actually exploit this and how (not
  a generic security lecture)
- **Cost of inaction** — what compounds if we ship as-is
- **Cost of a bad fix** — what regresses if we fix it carelessly
- **Proposed fix** — concrete code shape, with the alternative considered
- **Verification gates** — the tests that must pass before merging
- **Rollback** — how to undo if the fix misbehaves in the wild

Recommended reading order: skim "What & where" + "Proposed fix" for all
items first to build a mental map, then decide PR grouping.

## Threat model recap

ECC is installed on a developer's laptop, not exposed on a network. The
relevant adversaries are, in rough order of seriousness:

1. **A future malicious / careless ECC contributor** — most concrete, since
   the codebase grows by PRs from outside the immediate maintainer set.
   Defenses are CI gates, validators, and avoiding "footgun" patterns that
   look fine in isolation but compose into vulnerabilities.
2. **A compromised upstream dependency** — limited by the very small
   runtime dep surface (`@iarna/toml`, `ajv`, `sql.js`), but still real.
3. **A model output / prompt-injection payload** trying to weaponize a
   hook or tool. Defenses are the Claude Code permission model and the
   `CLAUDE.md` Prompt Defense Baseline; ECC ships content, not a runtime
   to enforce these.
4. **A local attacker who already has shell access as the user.** Almost
   nothing in scope for ECC defends against this — they already win;
   ECC can only avoid giving them *better* persistence/elevation.

We are explicitly **not** defending against: nation-state adversaries with
kernel-level access; supply-chain attacks on Node.js itself; users who
deliberately disable the Claude Code permission model.

---

## Finding 1 — MEDIUM: `${PM_EXEC}` interpolated into `bash -lc`

**What & where**

`scripts/codex/merge-mcp-config.js:70` builds the GitHub MCP bootstrap
command as a template literal:

```js
const GH_BOOTSTRAP = `token=$(gh auth token 2>/dev/null || true); ...
  exec ${PM_EXEC} @modelcontextprotocol/server-github`;
```

`PM_EXEC` then lands inside a `bash -lc` argv at line `:99`.

**Realistic threat model — narrower than the audit first framed**

`PM_EXEC` is sourced from `pmConfig.config.execCmd` (line `:47`).
`pmConfig` comes from `getPackageManager()` in
`scripts/lib/package-manager.js:163`. That function reads the package
manager **name** from env, project config, package.json, or lock file —
but then looks the `execCmd` **value** up in a hardcoded
`PACKAGE_MANAGERS` table inside that same source file. A user cannot
inject an arbitrary `execCmd` string by editing their `package.json` or
setting an env var; the worst they can do is choose between the table's
existing entries (`npx`, `pnpm dlx`, `yarn dlx`, `bunx`).

So today's exploit path is: a future PR adds a new entry to
`PACKAGE_MANAGERS` (or modifies an existing one) with a value containing
shell metacharacters. The audit grading of MEDIUM is justified not by
present exploitability but by:

- The pattern is a footgun that will be copy-pasted to new MCP servers.
- A reviewer skimming "we use a hardcoded table" may miss a subtle
  metachar slipping in (`pnpm dlx --foo` containing a flag with `;` in
  a future ecosystem fork).
- The generated config is **persisted** to the user's Codex MCP config,
  so once it's there it re-executes every Codex restart — much worse
  than transient process-time RCE.

**Cost of inaction**

- One bad future commit to `PACKAGE_MANAGERS` becomes a persistent code
  execution gadget on every user who runs `install-apply.js` after that
  commit.
- The pattern propagates if other MCP servers want token forwarding —
  cargo-culting `bash -lc` is the path of least resistance for the
  next contributor.

**Cost of a bad fix**

- The GitHub MCP server **must** receive `GITHUB_PERSONAL_ACCESS_TOKEN`
  in its environment. If our replacement plumbing forgets to set the env
  var, the MCP server falls back to unauthenticated GitHub and either
  fails or silently degrades (rate-limited, no private repo access).
- Existing users with the **old** vulnerable config in their Codex
  `mcp_servers` block continue to run the bash string until they
  re-run `install-apply.js`. If our fix changes the diff-detection logic
  (which uses `fields` for drift checking, see `dlxServer` line `:79`),
  we might mis-detect drift and not offer to update their config, or
  we might over-eagerly rewrite configs that users have customised.
- Some users invoke `bash` from non-login shells where `gh auth token`
  resolves differently (no `PATH` to `gh`). A fix that drops the `-l`
  semantics could surface latent `PATH` bugs as "GitHub MCP broken
  after upgrade" reports.

**Proposed fix**

Add a tiny ECC-owned helper script
`scripts/mcp/gh-bootstrap.sh` (~10 lines):

```bash
#!/usr/bin/env bash
set -euo pipefail
if token=$(gh auth token 2>/dev/null); then
  export GITHUB_PERSONAL_ACCESS_TOKEN="$token"
fi
exec "$@"
```

Then rewrite the GitHub MCP entry in `merge-mcp-config.js` to:

```js
const ghBootstrapPath = path.join(__dirname, '..', 'mcp', 'gh-bootstrap.sh');
fields: {
  command: ghBootstrapPath,
  args: [...PM_EXEC_PARTS, '@modelcontextprotocol/server-github'],
  startup_timeout_sec: DEFAULT_MCP_STARTUP_TIMEOUT_SEC,
}
```

No template literal, no `bash -lc`, no interpolation. The pm components
become argv tokens; the helper script handles env forwarding and execs
into the MCP server with the rest of argv. The shell-quoting failure
mode is eliminated by construction.

**Alternative considered:** quoting the interpolation with a
`shell-quote`-style escape. Rejected because it leaves the
template-literal pattern in place to be copy-pasted, and adds a
runtime dependency on shell-quote semantics that future readers must
re-verify each time the line is touched. The helper-script approach
removes the pattern entirely.

**Verification gates**

1. Unit test in `tests/codex/merge-mcp-config.test.js`:
   - For each entry in `PACKAGE_MANAGERS`, assert that the generated
     GitHub MCP fields contain no shell metacharacters in any string
     field. Future contributor adds a bad pm → test fails immediately.
2. Unit test that `args[0]` of the bootstrap script equals
   `PM_EXEC_PARTS[0]` for each supported pm (regression-protects argv
   assembly).
3. Manual: on macOS and Linux, fresh ECC install with `gh` auth'd,
   spawn the GitHub MCP and confirm an authenticated call works
   (`mcp__github__get_authenticated_user` or equivalent).
4. Manual: same as above with `gh` not installed — assert that the MCP
   still starts (unauthenticated) and that ECC's install plan does
   not mis-detect drift.
5. CI must pass `node tests/run-all.js` and `npm audit signatures`
   (already wired).

**Rollback**

Revert the PR. The helper script and the MCP config field shape are
independent of any state; no migration is needed in either direction.
Users who already ran `install-apply.js` against the fixed version
have a config pointing at the helper script — if reverted, the next
`install-apply.js` rewrites them back to the bash-string form. No data
loss either way.

**Migration of existing users with the vulnerable config**

This is the most important judgment call. Options:

- **A — Drift detection only.** The next `install-apply.js` run notices
  the old `command = "bash"` block doesn't match the new fields and
  offers a diff. User accepts → upgraded. User declines → still
  vulnerable until they upgrade. *Pro: no surprise rewrites. Con:
  the fix doesn't help users who don't re-run install.*
- **B — Forced rewrite on next install-apply.** If we detect the old
  bash-string pattern, rewrite it without prompting (one-line note in
  output). *Pro: closes the vulnerability for users who run any
  install-apply. Con: surprises users who customised their config.*
- **C — Document only.** Ship the fix, tell users to re-run
  install-apply if they care. *Pro: zero blast radius. Con: most users
  won't read the release note.*

Recommendation: **A**, with a clearly-flagged warning in the diff
output ("⚠️ Security: this MCP entry uses a deprecated bash bootstrap
pattern; replace with the helper-script form?"). Avoids surprises while
making the security implication visible.

---

## Finding 2 — LOW: Unbounded metric/log growth

**What & where**

Three files grow append-only forever:

- `~/.claude/metrics/costs.jsonl` — `scripts/hooks/cost-tracker.js:150`
- `~/.claude/metrics/tool-usage.jsonl` —
  `scripts/hooks/session-activity-tracker.js:602`
- `~/.claude/ecc-metrics/compaction.log` —
  `scripts/hooks/pre-compact.js:30`

**Realistic threat model**

None — this is ops hygiene, not an attack surface. Worst case is the
disk filling up on a heavy user.

**Cost of inaction**

- 6 months in, a daily-driver user could see 100s of MB of
  `tool-usage.jsonl`. Append latency grows; SSD wear increases
  marginally; the file becomes too large for ad-hoc grep.
- Users on Macbooks with 256 GB SSDs running multiple ECC profiles
  feel this first.
- These same files are useful for cost analysis and "what did I do
  last week" reflection — silently dropping data would defeat the
  purpose.

**Cost of a bad fix**

- Default-on rotation with a low cap silently truncates data a user
  expected to be complete (e.g., they run a weekly script over
  `costs.jsonl` and lose entries).
- Rotation that uses `rename` mid-write could corrupt a JSONL line if
  another hook is mid-append (concurrent appends from sibling Claude
  Code sessions are possible).
- Rotation that deletes rather than archives loses audit material
  irreversibly.

**Proposed fix**

In `scripts/lib/utils.js`, augment `appendFile` with optional
size-based rotation:

```js
function appendFile(filePath, content) {
  const maxBytes = parseInt(process.env.ECC_METRICS_MAX_BYTES || '0', 10);
  if (maxBytes > 0) {
    try {
      const stat = fs.statSync(filePath);
      if (stat.size + content.length > maxBytes) {
        const archived = `${filePath}.${Date.now()}.archive`;
        fs.renameSync(filePath, archived);
      }
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
  fs.appendFileSync(filePath, content);
}
```

Default behaviour unchanged (env var unset → no rotation). Users opt
in by exporting `ECC_METRICS_MAX_BYTES=50000000` (50 MB) etc.
Rotation archives rather than deletes — users can prune archives with
standard tooling. The atomic `rename` followed by `appendFile` on a
fresh path is safe against concurrent writers because each session's
next append re-stats the (now smaller) file.

**Alternative considered:** time-based rotation (daily/weekly). Rejected
because size is what users actually care about (disk pressure), and
because cron-like time logic in a hook is more code and more failure
modes than checking `stat.size`.

**Verification gates**

1. Unit test in `tests/lib/utils.test.js`:
   - File at threshold-1, append happens, no rotation.
   - File at threshold, append happens, rotation triggered, archive
     file exists, new file starts fresh with this append's content.
   - Concurrent appends from two simulated callers don't lose data
     (both lines present across original + archive).
   - Env var unset → no rotation regardless of file size.
2. Manual: set `ECC_METRICS_MAX_BYTES=1024`, run a busy ECC session,
   confirm archive files accumulate with reasonable cadence.

**Rollback**

Revert the PR. Archived files remain on disk; no data loss in either
direction. Users who didn't set the env var see zero behaviour change
across the revert.

---

## Finding 3 — LOW: Hook stdin JSON depth/size cap

**What & where**

`scripts/hooks/run-with-flags.js:90-100` and individual hooks call
`JSON.parse(raw)` on stdin with no depth or size limit.

**Realistic threat model**

Effectively none today — Claude Code is the only producer of this
stdin and is trusted. Defense-in-depth against a future harness bug or
a third-party tool pretending to be Claude Code.

**Cost of inaction**

- A malformed stdin payload could spike CPU/memory in a hook.
- Hooks have a 30 s timeout so the blast radius is bounded.
- Realistically: zero observed cost. The case for fixing is hygiene
  + "we'd be embarrassed if this caused a CVE."

**Cost of a bad fix**

- Real Claude Code tool inputs can nest legitimately (`AskUserQuestion`
  with nested option arrays, `ToolList` results, large diffs in
  PostToolUse payloads). A depth cap set too low rejects valid input
  and silently disables a hook.
- We must test against captured real payloads, not just synthetic
  shapes.

**Proposed fix**

In `scripts/hooks/run-with-flags.js`, replace the bare `JSON.parse`
with a depth-limited variant:

```js
const MAX_JSON_DEPTH = 64;
const MAX_JSON_BYTES = 8 * 1024 * 1024; // 8 MB

function parseHookInput(raw) {
  if (raw.length > MAX_JSON_BYTES) {
    throw new Error(`Hook input exceeds ${MAX_JSON_BYTES} bytes`);
  }
  let depth = 0;
  let maxDepth = 0;
  for (const ch of raw) {
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth--;
    if (depth > maxDepth) maxDepth = depth;
  }
  if (maxDepth > MAX_JSON_DEPTH) {
    throw new Error(`Hook input nests deeper than ${MAX_JSON_DEPTH}`);
  }
  return JSON.parse(raw);
}
```

Depth checked structurally before parse to avoid spending parser work
on a deliberately-deep payload. Quote awareness is omitted because a
deliberately-deep adversarial payload is the failure mode we want to
reject anyway; a legitimate payload with quoted braces won't exceed
N=64 in practice.

64 is generous — captured Claude Code payloads top out in the low
teens. Caller catches the throw and falls back to passthrough (existing
non-blocking pattern in `run-with-flags.js`).

**Verification gates**

1. Unit test with captured real payloads from each hook event
   (`PreToolUse`, `PostToolUse`, `SessionStart`, `Stop`, `PreCompact`)
   — must parse cleanly under default limits.
2. Unit test with depth=70 → throws; depth=63 → succeeds.
3. Unit test with 10 MB blob → throws; 7 MB blob → succeeds.

**Rollback**

Revert the parser substitution. Hooks fall back to the bare
`JSON.parse`. No state, no migration.

---

## Finding 4 — LOW: Unicode normalisation in URL filter

**What & where**

`scripts/hooks/session-activity-tracker.js:102-116` uses literal
regex like `/^https?:/i` to strip URLs from logged tool params. Cyrillic
and full-width lookalikes bypass.

**Realistic threat model**

A user's tool-usage.jsonl ends up with a URL string they expected to
be redacted. The file lives in `~/.claude/`. The exposure is the user
reading their own log later, or sharing it for debugging.

**Cost of inaction**

Trivial. The filter is a privacy hygiene control, not a security
boundary. The 160-char truncation around it is the load-bearing limit.

**Cost of a bad fix**

NFKC normalisation could change the displayed string in the log in
ways the user doesn't expect (e.g., full-width digits become ASCII).
For log-reading, this is desirable; for any downstream tool that
expects byte-identical preservation, less so. ECC doesn't ship such a
downstream tool.

**Proposed fix**

Three-line change in the filter helper:

```js
function isLikelyUrl(str) {
  const normalized = str.normalize('NFKC');
  return /^https?:|^ftp:|^file:/i.test(normalized);
}
```

Apply to all URL-detecting paths in that file.

**Verification gates**

1. Unit test: full-width `ｈｔｔｐｓ://example.com` → filtered.
2. Unit test: Cyrillic `httрs://example.com` (Cyrillic `р`) →
   filtered.
3. Unit test: ASCII URL still filtered (regression).
4. Unit test: non-URL string with embedded Cyrillic char not
   filtered (no false positives).

**Rollback**

Revert. Filter returns to literal-prefix behaviour. No state.

---

## Finding 5 — LOW: Document redaction-vs-truncation distinction

**What & where**

`scripts/hooks/session-activity-tracker.js` applies regex-based
secret redaction AND a 160-char truncation to logged tool params. The
audit's concern: a future contributor may add a new secret pattern to
the regex list and believe they've added protection, while a separate
PR removes the truncation thinking it's redundant.

**Realistic threat model**

A future PR breaks the implicit invariant.

**Cost of inaction**

A future PR removes truncation → all subsequent ECC users log full
tool args including any secret format not in the regex list, to a
local file. Not a remote exfiltration, but a privacy regression.

**Cost of a bad fix**

Documentation that overstates the redaction's strength would be worse
than no doc at all.

**Proposed fix**

Two surfaces:

1. **In-code comment** at the top of the redaction function in
   `session-activity-tracker.js`:

   ```
   // SECURITY INVARIANT: secret redaction below is best-effort and may
   // miss novel token formats. The 160-char truncation in
   // sanitizeParamValue() is the load-bearing privacy control.
   // If you remove or weaken the truncation, this hook regresses
   // beyond what the regex list can recover.
   ```

2. **Section in `SECURITY.md`** (project root) under "Logging
   guarantees":

   > ECC writes a sanitised tool-usage log to
   > `~/.claude/metrics/tool-usage.jsonl`. Each tool param is
   > truncated to 160 characters and passes through a regex pass that
   > redacts common secret formats (AWS keys, GitHub PATs,
   > `Authorization` headers). The truncation is the load-bearing
   > limit; the redaction is best-effort defence-in-depth. Do not
   > assume custom-format secrets pasted into a tool arg are
   > redacted.

**Verification gates**

Markdown lint passes. No behaviour change to test.

**Rollback**

Revert. Docs are independent of runtime behaviour.

---

## Suggested PR breakdown

| PR | Contents | Reviewer effort | Why bundled |
|---|---|---|---|
| 1 | Finding 1 (MEDIUM): helper script + config rewrite + tests + drift-detection migration | medium | Single coherent change, needs careful manual test on macOS + Linux. Keep alone for clean revert. |
| 2 | Findings 3 + 4 (LOW × 2): hook input depth cap + Unicode URL filter | small | Both touch `scripts/hooks/`, both pure functions, both trivial to test in isolation. |
| 3 | Finding 2 (LOW): metric log rotation | small | Touches `scripts/lib/utils.js`, which is broadly used — keep alone so any regression localizes to this PR. |
| 4 | Finding 5 (LOW docs): SECURITY.md addition + in-code comment | trivial | Pure docs; can ship anytime. |

**Recommended sequence:** ship PR 4 first (zero risk, sets the
documentation baseline), then PR 1 (real fix), then PRs 2 and 3 in
parallel.

## Decisions needed from the maintainer

1. **Finding 1 migration mode** — Option A (diff prompt), B (forced
   rewrite), or C (docs only)? Recommendation: A.
2. **Finding 2 default** — Should `ECC_METRICS_MAX_BYTES` ship with a
   default value (e.g., 100 MB), or stay opt-in? Recommendation:
   opt-in for the first release; revisit if user reports indicate
   disk-fill is a real problem.
3. **Finding 3 limits** — Confirm `MAX_JSON_DEPTH=64` and
   `MAX_JSON_BYTES=8 MB` are not so tight that any real Claude Code
   payload hits them. Will validate during test design.
4. **CI gate** — Should PR 1 include a `scripts/ci/` validator that
   greps for `bash -lc` in any future MCP config and fails CI?
   Recommendation: yes, very cheap and prevents regression.

## Out of scope / deliberate non-action

- **Prompt-injection in agent/skill markdown** (Finding 3.6 in the
  audit). Tracked separately; the runtime defenses live in Claude
  Code itself, and the content discipline is an ongoing review
  practice for `agents/`, `skills/`, `rules/`.
- **Dependency CVE scanning** — already covered by `npm audit
  signatures` and `npm audit --audit-level=high` in
  `.github/workflows/ci.yml`. No change needed.
- **Hardening the MCP server itself** — out of scope; we ship the
  config, not the server.
- **Adding more redaction patterns** — explicitly avoided because it
  encourages reliance on the regex list. Finding 5's doc work is the
  correct response.

## Estimated cumulative effort

| PR | Engineer hours (with tests + review) |
|---|---|
| 1 | 4–6 h |
| 2 | 1–2 h |
| 3 | 2–3 h |
| 4 | 30 min |
| **Total** | **8–12 h** |

Most of PR 1's time is in manual cross-OS verification, not the code
change itself. The fixes are intentionally surgical; the bulk of the
work is reading-the-room (existing user configs, drift detection,
migration UX).

## After all PRs land

1. Update `docs/security/security-audit.md` with a "2026-06-XX
   re-audit" note marking the fixed findings.
2. Add a `SECURITY-CHANGELOG.md` entry summarizing what changed and
   why, so the next audit has historical context.
3. Schedule a calendar reminder for the quarterly re-audit
   (action-pin refresh + grep for new `bash -lc` patterns + dep
   surface check).

---

## Upstream sync impact

ECC is a fork that absorbs upstream changes via a weekly merge routine
(see `fork_sync_strategy` memory). Every file we modify becomes a
potential merge-conflict surface on each upstream sync. This section
maps each PR's file footprint to its measured upstream churn so the
maintainer can pick fixes whose ongoing sync cost is acceptable, and
suggests sidecar refactors where the cost is otherwise too high.

### Methodology

For each file in the impact set, measured:

```bash
git log upstream/main --oneline --since='6 months ago' -- <file>
```

Churn ranking used below:

- **HOT**: >15 commits / 6 mo (≈weekly) — high conflict probability each sync
- **WARM**: 5–15 commits / 6 mo (≈monthly) — moderate, occasional conflict
- **COOL**: 1–4 commits / 6 mo — low, conflicts rare
- **COLD**: 0 commits / 6 mo — effectively no conflict risk

Measurement date: 2026-05-19. Re-run before opening each PR if more
than 4 weeks have passed.

### Per-PR impact

#### PR 1 (MEDIUM fix) — moderate sync cost

| File | Type | Upstream churn | Last touch | Sync risk |
|---|---|---|---|---|
| `scripts/mcp/gh-bootstrap.sh` | NEW | n/a | n/a | none |
| `scripts/codex/merge-mcp-config.js` | EDIT | 7 / 6mo (WARM) | 2026-04-05 | moderate — conflict likely ~1 in 3 syncs |
| `tests/codex/merge-mcp-config.test.js` | NEW or EDIT (check) | unknown | n/a | low |
| `scripts/ci/validate-mcp-shell-strings.js` (proposed CI guard) | NEW | n/a | n/a | none |
| `scripts/lib/package-manager.js` (read-only — guard target only) | none | 11 / 6mo (WARM) | 2026-02-18 | n/a (we don't edit) |

**Tactical:** keep the edit window inside `merge-mcp-config.js` small.
The MEDIUM fix should change exactly the lines that build and wire the
GH bootstrap (lines ~61, 70, 99–100) — don't refactor surrounding code
in the same PR. Geographic locality of the edit keeps conflict scope
manageable when upstream touches that file.

**Sidecar consideration:** rejected. The minimal edit is already local
to one logical block; a sidecar would add code volume without reducing
the change footprint.

#### PR 2 (Findings 3 + 4) — high sync cost without mitigation

| File | Type | Upstream churn | Last touch | Sync risk |
|---|---|---|---|---|
| `scripts/hooks/run-with-flags.js` | EDIT | 7 / 6mo (WARM) | 2026-04-29 (3 weeks ago) | moderate-high — recent upstream activity |
| `scripts/hooks/session-activity-tracker.js` | EDIT | 9 / 6mo (WARM) | 2026-04-12 | high — actively-edited file |
| `tests/hooks/*.test.js` | NEW or EDIT (check) | unknown | n/a | low |

**Tactical for `session-activity-tracker.js`:** the Unicode filter
change is a 3-line edit inside one existing helper function
(`isLikelyUrl`-style). Keep the edit there; don't extract or move the
helper. Upstream tends to add new event types and tool-name filters,
not modify the URL helper — so a geographically-localised edit should
survive most merges.

**Tactical for `run-with-flags.js`:** the JSON depth cap is a new
function plus a single call-site swap. Recommend extracting the new
function to `scripts/lib/hook-input-parser.js` (NEW file). The hot
file then gains exactly one line (a require + call). Reduces our edit
surface in the hot file to a single line; bulk of logic lives in the
quiet new file.

**Sidecar consideration:** **recommended for the JSON parser** (see
above). Cheap upfront cost, large reduction in long-term sync friction.

#### PR 3 (log rotation) — highest sync cost; sidecar strongly recommended

| File | Type | Upstream churn | Last touch | Sync risk |
|---|---|---|---|---|
| `scripts/lib/utils.js` | EDIT | **23 / 6mo (HOT)** | 2026-04-02 | **high** — ~weekly churn, conflict expected on most syncs |
| `tests/lib/utils.test.js` | EDIT (check) | unknown | n/a | inherits hot |

**Tactical: this is the riskiest PR for sync cost.** `utils.js` is the
most-edited file in the impact set by ~2× the next-highest. A direct
edit to `appendFile` will collide with upstream changes regularly.

**Sidecar refactor strongly recommended:**

1. Add `scripts/lib/utils-rotation.js` (NEW) containing the size-based
   rotation logic as a standalone helper exporting a single function
   (e.g., `maybeRotate(filePath, contentLength)`).
2. In `utils.js`, modify `appendFile` to call the helper as its first
   line:

   ```js
   function appendFile(filePath, content) {
     require('./utils-rotation').maybeRotate(filePath, content.length);
     fs.appendFileSync(filePath, content);
   }
   ```

3. Bulk of the conflict-prone logic lives in the new quiet file; the
   hot file gets a one-line touch that is trivial to re-apply if
   upstream renames or reshapes `appendFile` (or moves it to
   `utils-fs.js`, etc.).

This mirrors the pattern recommended in the `fork_sync_strategy`
memory for `scope`-class features, scaled down for a single function.

#### PR 4 (docs) — minimal sync cost; one overlap with PR 2

| File | Type | Upstream churn | Last touch | Sync risk |
|---|---|---|---|---|
| `SECURITY.md` | EDIT or NEW (check `ls SECURITY.md`) | unknown | n/a | low |
| `scripts/hooks/session-activity-tracker.js` (header comment block) | EDIT | 9 / 6mo (WARM) | 2026-04-12 | already touched in PR 2 — **bundle the comment into PR 2** |

**Tactical:** bundle the header-comment edit into PR 2 so
`session-activity-tracker.js` is touched in exactly one PR. Keep the
`SECURITY.md` edit standalone in PR 4.

### Aggregate sync cost view

| Hot/warm file | Direct edits across the 4 PRs | Mitigation | Post-mitigation touch |
|---|---|---|---|
| `scripts/lib/utils.js` (HOT, 23/6mo) | 1 (PR 3) | sidecar refactor → `utils-rotation.js` | 1 line |
| `scripts/hooks/session-activity-tracker.js` (WARM, 9/6mo) | 1 (PR 2 + PR 4 bundled) | confine edits to existing helper + header comment | small contiguous |
| `scripts/hooks/run-with-flags.js` (WARM, 7/6mo) | 1 (PR 2) | sidecar refactor → `hook-input-parser.js` | 1 line |
| `scripts/codex/merge-mcp-config.js` (WARM, 7/6mo) | 1 (PR 1) | keep edit window minimal | small contiguous |

Without sidecar mitigations: expect 1–3 merge conflicts per month
across these four files, with `utils.js` contributing the bulk.

With sidecar mitigations: expect 0–1 conflicts per month, each
resolvable in under 5 minutes because the touch is a single line or a
small contiguous block.

### Cross-check against current fork divergence

Our fork's current 29-commit divergence from `upstream/main` (on
`main`) touches mostly `scripts/lib/install/**`, none of the files in
this audit's impact set. So these PRs will be **net-new divergence**
rather than additions to existing divergent files. That's a positive
data point — we're not piling new edits onto already-conflicted files.

### Recommended sequence (revised for sync cost)

1. **PR 4 first** (docs only) — zero sync cost, sets the SECURITY.md
   baseline so subsequent PRs have a place to add notes.
2. **PR 1** — MEDIUM fix, surgical edit to `merge-mcp-config.js`.
   Most user-facing of the four.
3. **PR 3 with sidecar refactor** — accept the upfront 2-file change
   to buy long-term sync cheapness on the hottest file.
4. **PR 2 with sidecar for `run-with-flags.js`** — same logic, smaller
   stakes.

### CI guard recommendation (ship with PR 1)

Add `scripts/ci/validate-mcp-shell-strings.js` (NEW file, zero sync
cost) that fails CI if:

1. Any file under `scripts/codex/` or `mcp-configs/` contains the
   substring `bash -lc` adjacent to a template-literal interpolation
   (`bash -lc ` followed within ~200 chars by `` ` ``).
2. Any entry in `scripts/lib/package-manager.js`'s `PACKAGE_MANAGERS`
   table has an `execCmd` value containing shell metacharacters
   (`;`, `|`, `&`, `` ` ``, `$(`, `>`, `<`).

Catches both the cargo-cult regression (someone copying the original
GH MCP pattern to a new server) and the upstream-contributor threat
model identified in PR 1's threat-model section. Both checks are
simple greps + a manual parse — under 50 lines total.

### When the analysis goes stale

This section uses commit counts measured on 2026-05-19. Re-run the
churn measurement before opening any of these PRs if more than 4
weeks have passed — upstream activity patterns shift, and a file
that was COOL in May may be HOT in July if a refactor lands.

To re-measure, run from the project root:

```bash
for f in scripts/codex/merge-mcp-config.js \
         scripts/hooks/run-with-flags.js \
         scripts/hooks/session-activity-tracker.js \
         scripts/lib/utils.js \
         scripts/lib/package-manager.js; do
  printf '%4d  %s\n' \
    "$(git log upstream/main --oneline --since='6 months ago' -- "$f" | wc -l)" \
    "$f"
done | sort -nr
```

If any file's count climbs into HOT (>15), revisit the sidecar
recommendations for that PR before proceeding.
