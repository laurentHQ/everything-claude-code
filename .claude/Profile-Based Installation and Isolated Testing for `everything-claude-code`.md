
---

# Deployment Specification: Profile-Based Installation and Isolated Testing for `everything-claude-code`

## 1. Context and Background

This specification is based on the repository:

```text
https://github.com/affaan-m/everything-claude-code
```

The repository is not a normal application, SDK, or library. It is better understood as an **agent harness distribution** for Claude Code and other AI coding environments.

It contains reusable assets that modify how AI coding agents behave, including:

```text
agents/
commands/
skills/
rules/
hooks/
mcp-configs/
installers/
scripts/
schemas/
```

In practical terms, the repo attempts to package a complete operating layer for AI coding assistants.

Instead of only giving Claude Code a prompt, it provides:

|Layer|What it does|
|---|---|
|Rules|Persistent instructions the agent should always follow|
|Skills|Reusable workflows and domain-specific procedures|
|Agents|Specialized subagents such as reviewer, planner, security reviewer|
|Commands|Slash-command workflows such as planning, review, TDD, verification|
|Hooks|Runtime checks before/after tool use, edits, commands, or session events|
|MCP configs|Optional external tool integrations|
|Installers|Scripts that copy/merge the above into Claude Code, Codex, Cursor, etc.|

So the repo is closer to an **AI agent operating kit** than a code dependency.

---

## 2. What the Repo Does

The repo helps improve AI coding workflows by giving the agent more structure, memory, guardrails, and reusable behaviors.

For example, after installation, a Claude Code environment may gain:

```text
- Coding rules
- Security review behavior
- TDD workflows
- Code review agents
- Planner agents
- Verification loops
- Pre-command safety checks
- Post-edit quality gates
- Session memory / learning hooks
- MCP integration templates
```

This matters because AI coding agents are powerful but inconsistent. They may:

```text
- edit too many files
- ignore project conventions
- weaken linting or formatter config
- create speculative abstractions
- forget previous decisions
- skip verification
- produce working but ugly code
- accidentally expose secrets
- follow malicious prompt-injection content
```

The repo tries to solve those problems by surrounding the agent with a more structured harness.

---

## 3. How to Clone the Repo

For review and experimentation:

```bash
git clone https://github.com/affaan-m/everything-claude-code.git
cd everything-claude-code
```

Then inspect the repo before installing anything:

```bash
ls
```

Important folders to review first:

```text
README.md
CLAUDE.md
SECURITY.md
package.json
install.sh
install.ps1
scripts/
hooks/
rules/
skills/
agents/
commands/
mcp-configs/
```

Do **not** immediately run a full install.

This repo can modify your AI coding environment. Depending on the selected install method, it may write into locations such as:

```text
~/.claude/
~/.codex/
~/.opencode/
~/.qwen/
.cursor/
.gemini/
```

That is why isolated testing is necessary.

---

## 4. Safe First Inspection

Before applying anything, run a dry run.

Example:

```bash
./install.sh --profile minimal --target claude --dry-run
```

Or, through npm-style usage:

```bash
npx ecc-install --profile minimal --target claude --dry-run
```

The dry run should show what would be installed without modifying your real environment.

Recommended first test:

```bash
./install.sh --profile minimal --target claude --dry-run
```

Avoid this at the beginning:

```bash
./install.sh --profile full --target claude
```

because a full install may add many rules, skills, agents, commands, hooks, and config changes.

---

## 5. Why Profiles Are Needed

Profiles are needed because not every project needs the same level of agent behavior.

A small personal coding project does not need the same agent setup as a government document-processing workflow. A security-sensitive client repo does not need the same hooks as a research sandbox.

Without profiles, installation becomes too blunt:

```text
Install everything
or
Install nothing
```

That is dangerous because “everything” may include:

```text
- many hooks
- many skills
- many commands
- MCP configs
- background observation logic
- security scanners
- session tracking
- quality gates
- global config changes
```

Profiles solve this by allowing controlled installation.

---

## 6. Profile Concept

A profile defines which parts of the agent harness should be installed for a specific context.

Example profile types:

|Profile|Purpose|
|---|---|
|`minimal`|Safe baseline, rules only|
|`developer`|Daily coding with planner, reviewer, TDD, verification|
|`security`|Defensive coding with secret scan, config protection, risk checks|
|`research`|Exploration, literature review, prototype workflows|
|`document-ai`|Court-document extraction workflow, schema validation, audit logs|
|`enterprise`|Governed deployment with strict controls and allowlisted tools|

A profile answers:

```text
Which rules should be installed?
Which skills are allowed?
Which agents should be available?
Which hooks should run?
Are MCP tools allowed?
Is installation project-local or user-global?
Can the profile write to global config?
Can it run shell hooks?
Does it need audit logs?
Can it be uninstalled cleanly?
```

---

## 7. Why Isolated Testing Is Required

This repo is powerful because it can change how your coding agent behaves.

That also creates risk.

If you install directly into your real Claude Code environment, you may not immediately know:

```text
- which files were added
- which hooks are now active
- which rules are influencing the agent
- which MCP configs were merged
- whether existing settings were overwritten
- whether uninstall will cleanly remove everything
- whether behavior changes are caused by Claude Code or the installed harness
```

Therefore, testing should happen first in an isolated environment:

```text
./sandbox/home/.claude/
./sandbox/project/
./sandbox/state/
```

Instead of:

```text
~/.claude/
real-client-project/
real-production-repo/
```

The goal is to make installation observable before making it real.

---

## 8. Deployment Philosophy

The key principle is:

> Agent behavior is infrastructure.

That means it should be:

```text
versioned
profiled
tested
isolated
audited
reversible
```

You should not treat agent configuration as casual prompt files copied manually into a machine.

You should treat it like deployment infrastructure.

That means every installation should have:

```text
- a profile
- a dry-run install plan
- an allowed target directory
- an install-state registry
- rollback support
- uninstall support
- CI validation
- snapshot comparison
```

---

## 9. Recommended Safe Workflow

The safe workflow is:

```text
Clone repo
  ↓
Read README / SECURITY / install scripts
  ↓
Run dry-run minimal profile
  ↓
Generate install plan
  ↓
Apply into sandbox home
  ↓
Inspect installed files
  ↓
Run uninstall test
  ↓
Create or customize your own profiles
  ↓
Only then consider project-local install
  ↓
User-global install only with explicit approval
```

In command form:

```bash
git clone https://github.com/affaan-m/everything-claude-code.git
cd everything-claude-code

mkdir -p sandbox/home
mkdir -p sandbox/project
mkdir -p sandbox/state

./install.sh --profile minimal --target claude --dry-run
```

For your own deployment system, you should extend the installer so it can explicitly receive fake paths:

```bash
agent-harness plan \
  --profile developer \
  --target claude \
  --home ./sandbox/home \
  --project-root ./sandbox/project \
  --target-root ./sandbox/home/.claude \
  --state-dir ./sandbox/state \
  --dry-run
```

Then:

```bash
agent-harness apply \
  --profile developer \
  --target claude \
  --home ./sandbox/home \
  --project-root ./sandbox/project \
  --target-root ./sandbox/home/.claude \
  --state-dir ./sandbox/state
```

---

## 10. Why This Matters for Your Own Framework

For your Claude Code / agentic engineering framework, this repo is useful because it demonstrates the shift from:

```text
Prompt engineering
```

to:

```text
Harness engineering
```

The important idea is not simply “copy this repo.”

The important idea is to build your own controlled version of the pattern:

```text
profiles/
rules/
skills/
agents/
hooks/
install-state/
sandbox testing/
rollback/
```

For your own work, especially client and document-AI projects, the best approach is:

```text
Study this repo
Extract the architecture pattern
Create smaller controlled profiles
Test in isolation
Deploy only the minimum needed
```

---

## 11. Example: Why a `document-ai` Profile Matters

For your Vietnamese court-document extraction project, you do not need generic frontend, Go, Java, Kotlin, investor-material, or content-generation skills.

You need a focused agent harness for:

```text
document classification
field extraction
schema validation
ambiguity handling
confidence scoring
audit logging
review escalation
template improvement
evaluation against strong models
```

So instead of installing a full agent harness, you create:

```yaml
id: document-ai
description: Court-document extraction template engineering profile

includes:
  rules:
    - data-governance
    - pii-handling
    - schema-discipline

  skills:
    - extraction-template-engineering
    - schema-validation
    - ambiguity-handling
    - evaluation-against-strong-model

  agents:
    - document-type-classifier
    - field-extractor
    - extraction-evaluator
    - template-improver

  hooks:
    - pre-run-template-validation
    - post-run-schema-check
    - audit-log-capture

settings:
  scope: project
  allow_mcp: false
  require_audit_log: true
  write_scope: project-only
```

This keeps the agent focused and safer.

---

## 12. Updated Opening for the Spec

You can replace the beginning of the previous spec with this:

```markdown
# Deployment Specification: Profile-Based Agent Harness Installation in Isolated Environments

## 1. Context

This specification is inspired by the repository `affaan-m/everything-claude-code`, a large agent harness distribution for Claude Code and related AI coding environments.

The repo packages agents, commands, skills, rules, hooks, MCP configurations, and installer scripts. Its purpose is to improve AI coding agents by giving them persistent rules, reusable workflows, specialized subagents, runtime checks, and optional tool integrations.

Because this type of repository can modify user-level AI coding configuration such as `~/.claude`, `~/.codex`, `.cursor`, `.gemini`, or related harness directories, it should not be installed blindly. A profile-based and isolated deployment model is required.

Profiles allow different installation bundles for different usage contexts, such as minimal personal use, daily development, security-sensitive work, document-AI extraction workflows, research, or enterprise-governed deployment.

The deployment system must therefore support dry-run planning, sandbox installation, install-state tracking, rollback, uninstall, path-safety enforcement, and CI validation before any real installation is allowed.
```

---

This context should come before the technical deployment sections. It explains **what the repo is, how to clone it, what it does, why it is risky, and why profiles are the correct control mechanism**.