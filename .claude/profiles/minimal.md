# Profile: `minimal`

> Low-context Claude Code setup with rules, agents, commands, platform configs, and quality workflow support, but **no hook runtime**.

The lightest profile. Picks the bare minimum of guidance Claude needs to behave consistently in this repo, without installing anything that runs code at tool-call time.

## What it enables

| Module | Kind | Cost | Stability | Purpose |
|---|---|---|---|---|
| `rules-core` | rules | light | stable | Shared and language rules for supported harness targets |
| `agents-core` | agents | light | stable | Agent definitions and project-level agent guidance |
| `commands-core` | commands | medium | stable | Core slash-command library and command docs |
| `platform-configs` | platform | light | stable | Baseline platform configs, package-manager setup, MCP catalog |
| `workflow-quality` | skills | medium | stable | Eval, TDD, verification, compaction, learning skills |

**Totals:** 5 modules · 5 stable · 0 beta · 3 light + 2 medium · **no hooks**

## When to use

- You're trying ECC for the first time and want the smallest possible footprint.
- You operate in an environment where you cannot enable hooks (CI runners, restricted machines, security policies that forbid arbitrary command execution at tool-call time).
- You want Claude to *know about* this codebase's rules and commands without it actively gating your workflow.
- You're sharing a config with a colleague who has different preferences and you want a neutral baseline.

## When NOT to use

- You actually want hook automations (lint-on-save, security reminders, session-start prep). Use `core` or higher.
- You're doing significant engineering work — `developer` is the right default.
- You're going to add 4+ modules on top via `--with`. At that point, just use the next profile up.

## Risks

### Context / cost — 🟢 low

Smallest payload of any profile. Five modules, three of them tagged `light`. Negligible impact on context budget and session startup time. Skills load on demand so the `workflow-quality` skills (TDD, verification, eval, etc.) only consume context when actually invoked.

### Security — 🟢 low

No `hooks-runtime`, so no scripts run automatically before or after tool calls. The attack surface is restricted to what the rules and commands themselves do (read-only guidance) plus whatever MCP servers your `platform-configs` enable. If you also don't enable MCP servers, this is essentially a read-only profile.

### Behavioral surprise — 🟢 low

No hook-driven behavior change. Claude follows the rules in `rules/` and offers commands from `commands/`, but won't refuse edits, inject preambles, or rerun verification on its own. The least "opinionated" profile.

### Maintenance / drift — 🟢 low

All five modules are `stable`. None are beta. None depend on heavy external services. Upstream changes to these modules are infrequent and usually additive — the lowest sync burden of any profile.

## Install

```bash
node scripts/install-apply.js --profile minimal
```

Or to preview first:

```bash
node scripts/install-plan.js --profile minimal
```

## Trade-offs vs adjacent profiles

- **vs `core`:** Adds nothing beyond what `minimal` has *except* `hooks-runtime`. If you're on the fence, `core` is only one module heavier — the question is "do you want hooks?"
- **vs `developer`:** `developer` adds `hooks-runtime`, `framework-language`, `database`, and `orchestration`. Pick `developer` for active engineering; pick `minimal` for read/explain/explore.

## Compose pattern

If `minimal` is *almost* right but you need one extra capability, compose rather than upgrade:

```bash
node scripts/install-apply.js --profile minimal --with skill:database-migration
```

This stays cheap. Jumping straight to `full` to get one skill is a common over-install mistake.
