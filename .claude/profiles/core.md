# Profile: `core`

> Minimal harness baseline with commands, **hooks**, platform configs, and quality workflow support.

The smallest profile that includes hook automations. Adds nothing else beyond `minimal` except `hooks-runtime` — pick this if you want hooks but don't need framework/database/orchestration skills.

## What it enables

| Module | Kind | Cost | Stability | Purpose |
|---|---|---|---|---|
| `rules-core` | rules | light | stable | Shared and language rules for supported harness targets |
| `agents-core` | agents | light | stable | Agent definitions and project-level agent guidance |
| `commands-core` | commands | medium | stable | Core slash-command library and command docs |
| `hooks-runtime` | hooks | medium | stable | **Runtime hook configs and hook script helpers** |
| `platform-configs` | platform | light | stable | Baseline platform configs, package-manager setup, MCP catalog |
| `workflow-quality` | skills | medium | stable | Eval, TDD, verification, compaction, learning skills |

**Totals:** 6 modules · 6 stable · 0 beta · 3 light + 3 medium · **hooks enabled**

## When to use

- You want hook automations (session start, pre/post-edit, lifecycle hooks) but no domain skills.
- You're a writer, PM, or ops engineer who interacts with code but doesn't author much — hooks help keep sessions tidy without the engineering skill weight.
- You want to evaluate hook behavior in isolation before adding more modules on top.
- You operate in a small team and want a shared lean baseline.

## When NOT to use

- You need hooks **and** active engineering capability → use `developer`.
- You can't run hooks in your environment → drop to `minimal`.

## Risks

### Context / cost — 🟢 low

Only one module heavier than `minimal`. Hook scripts themselves run as separate processes and don't consume conversation context. Total context impact is essentially identical to `minimal` — what changes is wall-clock time per tool call, since hooks add latency.

### Security — 🟡 medium

`hooks-runtime` activates the hook stack. Hook scripts run with the same privileges as the harness — they can read files, run commands, and (depending on configuration) block tool calls. Risk depends entirely on which hooks are wired in `.claude/settings.json` and which plugins are enabled. Audit `settings.json` after install to confirm only intended hooks are active.

### Behavioral surprise — 🟡 medium

Hooks can change perceived Claude behavior: PreToolUse hooks may block edits, PostToolUse formatters may rewrite files after you save them, Stop hooks may run at end of turn. First-time users sometimes interpret hook output as Claude itself acting — set expectations or document the hook stack for your team.

### Maintenance / drift — 🟢 low

All modules stable. Hook configurations are versioned with the repo, so upstream changes to hook helpers are tracked alongside the code that calls them. Slightly higher drift than `minimal` because `hooks-runtime` evolves more than rules/agents, but still in the low-friction band.

## Install

```bash
node scripts/install-apply.js --profile core
```

After install, check which hooks were enabled:

```bash
node scripts/list-installed.js --kind hooks
```

## Trade-offs vs adjacent profiles

- **vs `minimal`:** Only difference is `hooks-runtime`. Pick `core` if you want any hook automation at all.
- **vs `developer`:** `developer` adds `framework-language`, `database`, `orchestration`. Pick `developer` if you're writing application code; pick `core` if you're not.
- **vs `security`:** `security` adds the `security` skills module on top of `core`. If your day-to-day is security review, `security` is the right pick.

## Compose pattern

Use `core` as a foundation when no domain profile fits, then layer on the specific modules you need:

```bash
node scripts/install-apply.js --profile core --with skill:framework-design --with skill:tdd
```
