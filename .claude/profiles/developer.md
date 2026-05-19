# Profile: `developer`

> Default engineering profile for most ECC users working across app codebases.

The recommended starting point for active engineering work. Adds language/framework skills, database skills, and orchestration on top of the `core` baseline.

## What it enables

| Module | Kind | Cost | Stability | Purpose |
|---|---|---|---|---|
| `rules-core` | rules | light | stable | Shared and language rules |
| `agents-core` | agents | light | stable | Agent definitions |
| `commands-core` | commands | medium | stable | Core slash-command library |
| `hooks-runtime` | hooks | medium | stable | Runtime hook configs |
| `platform-configs` | platform | light | stable | Platform configs, MCP catalog |
| `workflow-quality` | skills | medium | stable | Eval, TDD, verification, learning |
| `framework-language` | skills | medium | stable | Core framework, language, and app-engineering skills |
| `database` | skills | medium | stable | Database and persistence skills |
| `orchestration` | orchestration | medium | **beta** | Worktree/tmux orchestration runtime and workflow docs |

**Totals:** 9 modules · 8 stable · 1 beta · 3 light + 6 medium · **hooks enabled**

## When to use

- You're an application engineer doing day-to-day coding work.
- You want hook automation plus framework/language guidance plus database support.
- You work in repos that benefit from worktree-based parallel branches (the `orchestration` module).
- You're not sure which profile to pick and you write code regularly — this is the safe default.

## When NOT to use

- You don't work in code → use `core` or `minimal`.
- You need specialised security review tooling → consider `security` (or `developer` + the `security` module via `--with`).
- You need research/writing skills → `research`.
- You're touching ML pipelines, supply chain, or media generation → consider `full` or compose specific modules onto `developer`.

## Risks

### Context / cost — 🟡 medium

Nine modules with six in the `medium` cost tier. Noticeable but manageable session weight. Most skills load on demand. The `framework-language` and `database` modules add a sizeable skill catalogue that Claude indexes at session start — expect slightly longer cold-start than `core` or `minimal`.

### Security — 🟡 medium

Same surface as `core` (hooks active) plus orchestration which can spawn worktrees and (depending on configuration) tmux sessions or background processes. Audit which orchestration hooks are wired before trusting the profile in shared environments.

### Behavioral surprise — 🟡 medium

The `framework-language` skills can be opinionated about idioms (e.g., insisting on certain patterns, refactoring style). `workflow-quality` introduces TDD/verification skills that may prompt Claude to write tests before implementation when invoked. None of this is automatic — but expect Claude to *suggest* these workflows more often than with `core`.

### Maintenance / drift — 🟡 medium

The `orchestration` module is **beta** and tends to be the first to conflict during upstream sync (worktree tooling is actively evolving upstream). Eight stable modules around it provide ballast, but expect periodic resolution work on `orchestration` files. The `framework-language` skill catalogue also grows quickly upstream and occasionally restructures.

## Install

```bash
node scripts/install-apply.js --profile developer
```

Preview first to see the orchestration files that will land:

```bash
node scripts/install-plan.js --profile developer
```

## Trade-offs vs adjacent profiles

- **vs `core`:** Adds `framework-language`, `database`, `orchestration`. Pick `developer` when you write code.
- **vs `security`:** `security` swaps `framework-language`/`database`/`orchestration` for the `security` module. If you do both engineering and security, install `developer` plus `--with skill:security-review`.
- **vs `research`:** Different domain — `research` adds APIs/business-content; `developer` adds frameworks/databases. They overlap on `core` only.
- **vs `full`:** `full` adds 12 more modules including 3 more beta and 3 heavy. Use `full` only if you actively need those domains; otherwise compose specific modules onto `developer`.

## Compose pattern

Common additions to `developer`:

```bash
# Add security review for a specific session
node scripts/install-apply.js --profile developer --with skill:security-review

# Add ML workflow skills for a data-science adjacency project
node scripts/install-apply.js --profile developer --with skill:ml-deployment

# Drop orchestration if you don't use worktrees
node scripts/install-apply.js --profile developer --without orchestration
```

The `--without orchestration` pattern is popular for users who find worktree tooling more friction than value — it gives you a stable, all-stable 8-module variant.
