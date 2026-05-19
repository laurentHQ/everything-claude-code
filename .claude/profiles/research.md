# Profile: `research`

> Research and content-oriented setup for investigation, synthesis, and publishing workflows.

Adds research-API skills, business/content skills, and social-distribution on top of `core`. Optimised for reading-and-writing work rather than code authoring.

## What it enables

| Module | Kind | Cost | Stability | Purpose |
|---|---|---|---|---|
| `rules-core` | rules | light | stable | Shared and language rules |
| `agents-core` | agents | light | stable | Agent definitions |
| `commands-core` | commands | medium | stable | Core slash-command library |
| `hooks-runtime` | hooks | medium | stable | Runtime hook configs |
| `platform-configs` | platform | light | stable | Platform configs, MCP catalog |
| `workflow-quality` | skills | medium | stable | Eval, TDD, verification, learning |
| `research-apis` | skills | medium | stable | Research and API integration skills for deep investigations |
| `business-content` | skills | **heavy** | stable | Business, writing, market, and investor communication skills |
| `social-distribution` | skills | medium | stable | Social publishing and distribution skills |

**Totals:** 9 modules · 9 stable · 0 beta · 3 light + 5 medium + 1 heavy · **hooks enabled**

Dependency note: `social-distribution` depends on `business-content`. Asking for one pulls the other.

## When to use

- Investigation work: synthesising sources, building research summaries, writing reports.
- Content production: articles, briefs, market analyses, investor updates.
- Publishing workflows: drafting → editing → distribution across channels.
- Heavy use of external APIs (search, knowledge graphs, retrieval).
- You're a PM, analyst, founder, or writer using Claude as a research and writing partner.

## When NOT to use

- You're primarily writing application code → use `developer`.
- You only occasionally write content → use `core` and pull in `business-content` per-session with `--with`.
- You don't use external research APIs and don't publish to social → the profile is overkill; pick `core`.

## Risks

### Context / cost — 🟡 medium

The `business-content` module is the only `heavy` cost module in the profile and accounts for most of the weight. Nine modules total. Cold-start is noticeably slower than `core`/`developer` but still well below `full`. Skill load is lazy, so per-turn cost stays moderate unless you actively invoke multiple writing skills.

### Security — 🟡 medium

Same hook surface as `core`. The `research-apis` module typically wires external services (search APIs, retrieval, knowledge graphs) through MCP. Each external service is a potential exfiltration path for whatever conversation context Claude sends to it. Audit MCP configurations and API scopes before using on sensitive material.

The `social-distribution` module includes publishing helpers — if any are configured with real account tokens, the profile has *write* surface to external platforms. Default install does not enable publishing; you must wire credentials yourself.

### Behavioral surprise — 🟡 medium

The `business-content` skills can push Claude toward more polished, longer-form output by default — useful for content work, slightly verbose for code work. The research skills can encourage exhaustive multi-source synthesis when you wanted a quick answer. Both biases are easy to override per turn but worth knowing.

### Maintenance / drift — 🟡 medium

All modules stable, but the `research-apis` module depends on external service shapes (search APIs, retrieval endpoints) that change outside the ECC repo. Upstream sync may bring breaking changes if a provider updated its SDK. `business-content` and `social-distribution` change less often but evolve to track platform-specific best practices (e.g., LinkedIn formatting rules).

## Install

```bash
node scripts/install-apply.js --profile research
```

Preview to see which API integrations will activate:

```bash
node scripts/install-plan.js --profile research
```

## Trade-offs vs adjacent profiles

- **vs `core`:** Adds `research-apis`, `business-content`, `social-distribution`. Pick `research` if those are your daily tools; otherwise compose per-session.
- **vs `developer`:** Different domain. `developer` is code-focused; `research` is content-focused. They share `core` only. Some users install both into separate destinations — for example `developer` into a project-local target (`--target cursor` from a code repo) and `research` into the global `claude` target for general use.
- **vs `full`:** `full` includes everything in `research` plus 12 more modules. Pick `research` if content/research is the focus and you don't need engineering breadth.

## Compose pattern

For founders/PMs who occasionally need code adjacency:

```bash
node scripts/install-apply.js --profile research \
  --with skill:framework-design \
  --without skill:social-distribution
```

The `--without skill:social-distribution` is common if you don't publish to social platforms — it trims a module without losing the research/content core.

## Working with this profile

- **Set up MCP servers explicitly.** The `research-apis` module is most useful when wired to real research backends (Exa, Linkup, Tavily, etc.). Without those, the module's skills know about the workflows but have no execution surface.
- **Separate destinations for sensitive material.** If you're researching regulated/confidential content, install `research` only into a project-local target (`cd` into the specific repo, then `--target cursor` / `--target zed` / etc.) instead of the global `~/.claude/`. That way the external research API surface is opt-in per project rather than always-on globally. Tag the install with `--scope project` for the audit log.
