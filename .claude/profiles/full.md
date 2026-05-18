# Profile: `full`

> Complete ECC install with all currently classified modules.

Everything in the catalogue. The heaviest profile by far. Pick this only if you actively need the breadth — for most users, a smaller profile + targeted `--with` additions is faster and safer.

## What it enables

| Module | Kind | Cost | Stability | Purpose |
|---|---|---|---|---|
| `rules-core` | rules | light | stable | Shared and language rules |
| `agents-core` | agents | light | stable | Agent definitions |
| `commands-core` | commands | medium | stable | Core slash-command library |
| `hooks-runtime` | hooks | medium | stable | Runtime hook configs |
| `platform-configs` | platform | light | stable | Platform configs, MCP catalog |
| `framework-language` | skills | medium | stable | Framework, language, app-engineering |
| `database` | skills | medium | stable | Database and persistence |
| `workflow-quality` | skills | medium | stable | Eval, TDD, verification, learning |
| `security` | skills | medium | stable | Security review and frameworks |
| `research-apis` | skills | medium | stable | Research and API integrations |
| `business-content` | skills | **heavy** | stable | Business, writing, market, investor comms |
| `operator-workflows` | skills | medium | **beta** | Connected-app operator workflows |
| `social-distribution` | skills | medium | stable | Social publishing and distribution |
| `media-generation` | skills | **heavy** | **beta** | Media generation, technical explainers, AI-assisted editing |
| `orchestration` | orchestration | medium | **beta** | Worktree/tmux orchestration |
| `swift-apple` | skills | medium | stable | Swift, SwiftUI, Apple platform |
| `agentic-patterns` | skills | medium | stable | Agentic engineering, autonomous loops, LLM pipelines |
| `devops-infra` | skills | medium | stable | Deployment, Docker, infrastructure |
| `machine-learning` | skills | medium | **beta** | Production ML engineering workflows |
| `supply-chain-domain` | skills | **heavy** | stable | Supply chain, logistics, procurement |
| `document-processing` | skills | medium | stable | Document processing skills |

**Totals:** 21 modules · 17 stable · **4 beta** · 3 light + 15 medium + **3 heavy** · **hooks enabled**

Beta modules: `operator-workflows`, `media-generation`, `orchestration`, `machine-learning`.

## When to use

- You're building, curating, or maintaining ECC itself.
- You're a power user who wants every skill available without thinking about composition.
- You're evaluating the catalogue — seeing what's there before picking a smaller profile.
- You operate across many wildly different domains in a single Claude install (rare).
- You're seeding a sandbox install to test interactions between modules.

## When NOT to use

- You have specific work to do and know roughly what skills it needs → pick a smaller profile and `--with` what's missing.
- You operate in a context-constrained environment (limited memory, slow cold-start tolerance) → `full` will be noticeably heavier.
- You're risk-averse about behavioral changes → `full` activates four beta modules and three heavy modules; you'll feel it.

## Risks

### Context / cost — 🔴 very high

21 modules, of which 3 are `heavy` cost (`business-content`, `media-generation`, `supply-chain-domain`). Cold-start is the slowest of any profile. Skill catalogues are large enough that occasional context pressure shows up in long sessions. If you find Claude getting confused about which skill to invoke, that's a signal you're carrying skills you don't use — drop to a smaller profile.

### Security — 🟠 high

Largest hook + MCP surface of any profile. Combines:

- All hook stacks (`hooks-runtime`).
- Multiple modules with external service integrations (`research-apis`, `operator-workflows`, `social-distribution`, `media-generation`).
- Orchestration tooling capable of spawning worktrees and background processes.
- ML deployment workflows that may have cloud credentials wired.

For a personal dev machine this is usually fine. For shared infrastructure or environments where you don't fully trust the plugin stack, audit which hooks and MCP servers are wired before relying on `full` in production-adjacent work.

### Behavioral surprise — 🔴 very high

The cumulative effect of 21 modules is that Claude has a lot of opinions: when to suggest TDD, when to flag security issues, when to suggest publishing, when to recommend a worktree, when to verify ML reproducibility, etc. Two same-shape requests in different sessions can route through different skills depending on phrasing. This is the unavoidable cost of breadth. If you frequently override Claude's suggestions, you're using too large a profile.

### Maintenance / drift — 🔴 very high

`full` carries every beta module. Each beta module is structurally less stable upstream and is the most likely to conflict on syncs. `orchestration`, `media-generation`, `operator-workflows`, and `machine-learning` all evolve quickly. Add the 3 heavy modules (more files = more places upstream can change) and `full` will reliably be the highest-maintenance profile on weekly syncs.

If you're following the fork-sync strategy ([see memory](file:///home/laurent_hq_nguyen_gmail_com/.claude/projects/-home-laurent-hq-nguyen-gmail-com-projects-everything-claude-code/memory/fork_sync_strategy.md)), `full` significantly increases the rerere cache size and the frequency of conflict resolutions you'll need to seed.

## Install

```bash
node scripts/install-apply.js --profile full
```

**Always preview first** — `full` lays down a lot of files:

```bash
node scripts/install-plan.js --profile full
```

## Trade-offs vs other profiles

- **vs `developer`:** `full` adds 12 modules, 3 more beta, 3 heavy. Pick `developer` and `--with` the specific missing module instead unless you genuinely span 5+ domains.
- **vs `research`:** `full` includes everything in `research` plus engineering, security, ML, swift, supply-chain. Pick `research` if content is your focus.
- **vs `security`:** `full` includes `security` and everything else. Pick `security` if security is the primary lens — the focused profile is calmer.

## Trimming pattern

If you installed `full` but a few modules cause noise, trim rather than reinstalling:

```bash
node scripts/install-apply.js --profile full \
  --without skill:media-generation \
  --without skill:supply-chain-domain \
  --without skill:swift-apple
```

This is the most common `full` user pattern — start broad, then prune.

## Working with this profile

- **Periodic audit.** Run `node scripts/list-installed.js` quarterly. If there are skills you've never invoked, drop them.
- **Sandbox first.** Test new module combinations in an isolated location before installing globally. The pattern: create a throwaway directory, `cd` in, install with a project-local target (`--target cursor` or `--target zed`), and tag with `--scope sandbox` for audit logs. Only promote to the global `claude` target (`--scope user`) once you've confirmed the combination behaves as expected.
- **Track which modules conflict on syncs.** Use the `scripts/upstream-merge-analyze.js` artifacts directory over time — if the same module appears every sync, decide whether to upstream the change or trim the module.
