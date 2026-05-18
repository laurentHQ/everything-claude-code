# Profile: `security`

> Security-heavy setup with baseline runtime support and security-specific guidance.

Adds the `security` skills module on top of `core`. Designed for security review, threat modelling, and audit work — not for general engineering.

## What it enables

| Module | Kind | Cost | Stability | Purpose |
|---|---|---|---|---|
| `rules-core` | rules | light | stable | Shared and language rules |
| `agents-core` | agents | light | stable | Agent definitions |
| `commands-core` | commands | medium | stable | Core slash-command library |
| `hooks-runtime` | hooks | medium | stable | Runtime hook configs |
| `platform-configs` | platform | light | stable | Platform configs, MCP catalog |
| `workflow-quality` | skills | medium | stable | Eval, TDD, verification (security module depends on this) |
| `security` | skills | medium | stable | Security review and security-focused framework guidance |

**Totals:** 7 modules · 7 stable · 0 beta · 3 light + 4 medium · **hooks enabled**

Dependency note: `security` depends on `workflow-quality` — both are pulled in even if you only ask for one.

## When to use

- Security review of a codebase or PR.
- Threat modelling sessions.
- Auditing an unfamiliar repo before integrating it.
- You want Claude to actively look for OWASP-class issues, secrets, unsafe patterns, and supply-chain red flags.
- You're running `/security-review` as your primary command.

## When NOT to use

- You're writing application code day-to-day → use `developer`. The `security` skills are review-oriented, not author-oriented.
- You only occasionally need security input → use `core` or `developer` and add `--with skill:security-review` per session.
- You're auditing dependencies specifically → consider composing `core` with the supply-chain module via `--with`.

## Risks

### Context / cost — 🟢 low

Only one more module than `core`. The `security` skill catalogue is moderate, not heavy. Cold-start cost is barely different from `core`.

### Security — 🟡 medium

Same hook stack as `core`. The `security` skills are read/analysis-focused; they don't add new runtime hooks themselves. The main *security-of-the-profile-itself* consideration: security review workflows often involve reading secrets, credential files, and sensitive config. Make sure your hook configuration doesn't log tool inputs/outputs containing this data.

### Behavioral surprise — 🟠 high

This is the most opinionated profile. The `security` skills push Claude toward:

- Flagging secrets, hardcoded credentials, and unsafe patterns even when you're not asking for review.
- Suggesting safer alternatives mid-edit (e.g., parameterised queries, input validation).
- Refusing or warning about commands that look like exploit primitives.
- Asking clarifying questions about authorization context for dual-use security tooling.

This is **intentional and useful for security work** but can feel intrusive for general coding. If you find yourself dismissing security suggestions every session, you're using the wrong profile — switch to `developer`.

### Maintenance / drift — 🟢 low

All modules stable. The `security` module evolves more slowly than orchestration or ML modules upstream — security guidance is sticky. Low ongoing sync burden.

## Install

```bash
node scripts/install-apply.js --profile security
```

Pair with the security-review command:

```bash
node scripts/install-apply.js --profile security --with command:security-review
```

(Already included if it ships in `commands-core` — verify with `node scripts/list-installed.js --kind commands`.)

## Trade-offs vs adjacent profiles

- **vs `core`:** Adds the `security` skills module. If you do security work *sometimes*, prefer `core` + `--with skill:security-review` per session; pick `security` if it's your daily mode.
- **vs `developer`:** Different domain. `security` is for review; `developer` is for authoring. Some users install both — `developer` into the global `claude` target for everyday work, and `security` into project-local targets (`--target cursor` / `--target zed`) for repos where security review is the primary mode.
- **vs `full`:** `full` includes `security` already plus 13 other domains. If security is your primary lens, `security` is more focused and faster.

## Compose pattern

For security engineers who also write some code:

```bash
node scripts/install-apply.js --profile security \
  --with skill:framework-design \
  --with skill:database
```

That gives you the `security` profile augmented with the most common engineering skills, without the full weight of `developer`.

## Working with this profile

The high "behavioral surprise" rating is the trade-off. Two habits help:

1. **State authorization context up front** for dual-use work: "I'm reviewing this for an authorized pentest", "this is a CTF challenge", "I'm hardening our own production code". This lets the security skills cooperate rather than gate.
2. **Install into project-local targets** if you only want security guidance in specific repos. `cd` to the repo and run with `--target cursor` (or `zed`, `codebuddy`, etc.) instead of the default `claude` target — that puts the security skills in `./.cursor/` for that repo only, keeping your global `~/.claude/` baseline calmer. Tag with `--scope project` so the install is correctly recorded in the audit log.
