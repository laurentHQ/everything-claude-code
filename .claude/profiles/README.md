# Install profiles

Install profiles bundle modules from `manifests/install-modules.json` into named sets so a single `--profile <name>` flag picks the right baseline for a use case. Profiles are defined in `manifests/install-profiles.json` and applied by `scripts/install-apply.js`.

This directory holds a comprehensive guide per profile so you can choose deliberately rather than defaulting to `full`.

## Available profiles

| Profile | Modules | Best for | Page |
|---|---:|---|---|
| `minimal` | 5 | Low-context Claude Code setups; read-mostly sessions; constrained environments | [minimal.md](minimal.md) |
| `core` | 6 | Baseline harness for everyday tasks with hook support | [core.md](core.md) |
| `developer` | 9 | Day-to-day engineering across application codebases (the default for most users) | [developer.md](developer.md) |
| `security` | 7 | Security review, threat modelling, audit work | [security.md](security.md) |
| `research` | 9 | Investigation, synthesis, publishing | [research.md](research.md) |
| `full` | 21 | Power users, plugin development, anyone curating the full catalogue | [full.md](full.md) |

> Note: locale doc modules (`docs-*`) are not part of any profile. Add them per-install with `--locale <code>` (e.g. `--locale ja-jp`).

## Quick comparison

| Profile | Light | Medium | Heavy | Beta | Hooks | Heaviest modules |
|---|---:|---:|---:|---:|:---:|---|
| `minimal` | 3 | 2 | 0 | 0 | ❌ | — |
| `core` | 3 | 3 | 0 | 0 | ✅ | — |
| `developer` | 3 | 6 | 0 | 1 | ✅ | `orchestration` (beta) |
| `security` | 3 | 4 | 0 | 0 | ✅ | — |
| `research` | 3 | 5 | 1 | 0 | ✅ | `business-content` |
| `full` | 3 | 15 | 3 | 4 | ✅ | `business-content`, `media-generation` (beta), `supply-chain-domain` |

Cost classifications (`light` / `medium` / `heavy`) and stability (`stable` / `beta`) come straight from each module's metadata in `manifests/install-modules.json`. "Beta" modules can change in shape across upstream releases and tend to be the first to conflict on syncs.

## Risk-at-a-glance matrix

| Risk | `minimal` | `core` | `developer` | `security` | `research` | `full` |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Context / cost | 🟢 low | 🟢 low | 🟡 med | 🟢 low | 🟡 med | 🔴 high |
| Security surface | 🟢 low | 🟡 med | 🟡 med | 🟡 med | 🟡 med | 🟠 high |
| Behavioral surprise | 🟢 low | 🟡 med | 🟡 med | 🟠 high | 🟡 med | 🔴 high |
| Maintenance / drift | 🟢 low | 🟢 low | 🟡 med | 🟢 low | 🟡 med | 🔴 high |

🟢 low · 🟡 medium · 🟠 high · 🔴 very high. See per-profile pages for the concrete drivers behind each rating.

## How to choose

1. **Just trying it out?** → `minimal`. Smallest blast radius, easiest to remove.
2. **Day-to-day coding?** → `developer`. The sane default for application engineers.
3. **No hooks allowed in your environment?** → `minimal` (the only profile without `hooks-runtime`).
4. **Security review work?** → `security`. Adds the `security` module on top of the core baseline.
5. **Research / writing / publishing?** → `research`. Adds research APIs and business content modules.
6. **Building or curating ECC itself?** → `full`. Accept the cost; you need the visibility.

If two profiles look close, prefer the smaller one and add specific modules with `--with <component>` rather than jumping to the larger profile.

## Installing

The two options that decide *where files land*:

- **`--target <name>`** — picks the destination harness. Each target has a fixed location (see table below).
- **Current working directory** — for project-local targets, files land in `./<...>/` relative to wherever you ran the command. There is no `--path` or `--into` flag; you `cd` to the repo you want to configure.

`--scope` does **not** select a destination; see "What `--scope` actually does" below.

### `--target` → destination

| `--target` | Destination | Type |
|---|---|---|
| `claude` *(default)* | `~/.claude/` | Global home |
| `codex` | `~/.codex/` | Global home |
| `opencode` | `~/.opencode/` | Global home |
| `qwen` | `~/.qwen/` | Global home |
| `cursor` | `./.cursor/` *(cwd)* | Project-local |
| `antigravity` | `./.agent/` *(cwd)* | Project-local |
| `gemini` | `./.gemini/` *(cwd)* | Project-local |
| `codebuddy` | `./.codebuddy/` *(cwd)* | Project-local |
| `joycode` | `./.joycode/` *(cwd)* | Project-local |
| `zed` | `./.zed/` *(cwd)* | Project-local |

Global-home targets ignore your working directory — they always land in your home dir. Project-local targets always use the cwd at the time you ran the command.

### Common commands

```bash
# Default: install profile into ~/.claude/
node scripts/install-apply.js --profile developer

# Install profile into the Cursor configuration of a specific repo
cd /path/to/some-other-repo
node /path/to/everything-claude-code/scripts/install-apply.js --profile developer --target cursor

# Profile + extra component
node scripts/install-apply.js --profile developer --with skill:database-migration

# Profile minus a component you don't want
node scripts/install-apply.js --profile developer --without skill:orchestration

# Preview only, change nothing on disk
node scripts/install-plan.js --profile developer
```

Always run `install-plan.js` before `install-apply.js` the first time you try a profile in a new environment — it shows exactly which files will land where without making changes.

### Installing into a specific local repo

There is no flag pointing the installer at an arbitrary path. The pattern for project-local targets is:

```bash
cd /absolute/path/to/the/repo
node /absolute/path/to/everything-claude-code/scripts/install-apply.js \
  --profile developer \
  --target cursor
# → writes /absolute/path/to/the/repo/.cursor/...
```

For the `claude` target, `~/.claude/` is global — you cannot install a per-repo `.claude/` via this CLI. If you need per-repo Claude configuration, use the `cursor`/`zed`/etc. project-local targets, or maintain a separate `~/.claude/` per OS user.

### What `--scope` actually does

`--scope <project|user|sandbox>` is a **policy gate**, not a destination selector. It's passed through to `scripts/lib/install/policy.js`, where rules consume it. The most important rule is **R3**: a profile or settings file with `block_global_install: true` rejects `--scope user`, refusing to write a global install.

Today no shipped profile sets `block_global_install:true`, so `--scope` is largely advisory — it tags the install for audit-log purposes but does not change destinations or block anything by default. Set it accurately anyway:

- `--scope project` — you intend the install to be project-local (signal of intent for audit logs and any future policy rules).
- `--scope user` — you intend the install to be global (target=claude/codex/opencode/qwen).
- `--scope sandbox` — you're testing in an isolated sandbox install.

If you don't pass `--scope`, no scope is recorded and any `block_global_install` policy rule still applies if present.

## Related files

| File | Purpose |
|---|---|
| `manifests/install-profiles.json` | Profile → module mapping (source of truth) |
| `manifests/install-modules.json` | Module definitions, cost, stability, dependencies |
| `manifests/install-components.json` | Per-component details inside modules |
| `scripts/install-apply.js` | Apply a profile to a target |
| `scripts/install-plan.js` | Dry-run a profile install |
| `scripts/lib/install/policy.js` | Policy rules (e.g. R3: `block_global_install:true` rejects `scope:user`) |

## Maintenance

If you add/remove modules from a profile in `install-profiles.json`, update the corresponding `.md` here. The numbers in the comparison and risk tables are derived from module metadata — keep them in sync.
