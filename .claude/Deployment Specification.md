# Deployment Specification: Profile-Based Agent Harness Installation in Isolated Environments

## 1. Purpose

This specification defines how to structure, test, and deploy an **agent harness repository** that supports multiple installation profiles while ensuring all installations can be tested safely in isolated environments before touching real developer machines or production project repositories.

The goal is to avoid the common failure mode of agent tooling:

> A powerful Claude Code / Codex / Cursor configuration is installed globally, modifies many files, adds hooks, and becomes difficult to audit, revert, or reproduce.

Instead, this deployment model treats agent harness configuration as controlled infrastructure.

---

# 2. Deployment Goals

## 2.1 Primary objectives

The deployment system must support:

1. **Profile-based installation**
    
    - Minimal
        
    - Developer
        
    - Security
        
    - Research
        
    - Document AI
        
    - Enterprise
        
2. **Isolated test execution**
    
    - No writes to real `~/.claude`, `~/.codex`, `.cursor`, `.gemini`, or project directories during tests.
        
    - All install tests run inside fake home/project directories or containers.
        
3. **Dry-run planning**
    
    - Every install produces a readable install plan before mutation.
        
    - The plan shows files copied, JSON merged, hooks enabled, conflicts, and warnings.
        
4. **Install-state tracking**
    
    - Every installation writes an install-state registry.
        
    - The registry supports uninstall, rollback, drift detection, and audit.
        
5. **Controlled promotion**
    
    - A profile must pass schema validation, plan validation, sandbox installation, uninstall testing, and CI checks before it is eligible for real use.
        
6. **Enterprise-safe defaults**
    
    - Project-scoped installation by default.
        
    - User-global installation only with explicit flag.
        
    - MCP and background observers disabled unless explicitly allowed.
        

---

# 3. Recommended Repository Structure

```text
agent-harness/
  README.md
  package.json

  profiles/
    minimal.yaml
    developer.yaml
    security.yaml
    research.yaml
    document-ai.yaml
    enterprise.yaml

  modules/
    rules/
      common/
      security/
      data-governance/
      python/
      typescript/

    skills/
      tdd-workflow/
      verification-loop/
      security-review/
      extraction-template-engineering/
      schema-validation/
      ambiguity-handling/

    agents/
      planner.md
      code-reviewer.md
      security-reviewer.md
      document-type-classifier.md
      extraction-evaluator.md
      template-improver.md

    hooks/
      pre-command-risk-check/
      post-edit-quality-gate/
      secret-scan/
      config-protection/
      pre-run-template-validation/
      post-run-schema-check/
      audit-log-capture/

    mcp/
      context7.json
      github.json
      local-only.json

  installer/
    cli.ts
    plan.ts
    apply.ts
    uninstall.ts
    registry.ts
    validate.ts

    adapters/
      claude.ts
      codex.ts
      cursor.ts
      gemini.ts
      opencode.ts

  schemas/
    profile.schema.json
    install-plan.schema.json
    install-state.schema.json

  test/
    fixtures/
      fake-home/
      fake-project/
      fake-claude/
      fake-codex/

    snapshots/
      minimal/
      developer/
      security/
      document-ai/

    integration/
      install-minimal.test.ts
      install-developer.test.ts
      install-security.test.ts
      install-document-ai.test.ts
      uninstall.test.ts
      profile-conflict.test.ts
      path-safety.test.ts

  sandbox/
    .gitignore
```

---

# 4. Core Deployment Concept

The installer must never directly “install files.” It must first generate an **Install Plan**.

The flow is:

```text
Profile YAML
   ↓
Schema validation
   ↓
Dependency and module resolution
   ↓
Install plan generation
   ↓
Dry-run review
   ↓
Sandbox apply
   ↓
Snapshot comparison
   ↓
Uninstall test
   ↓
Promotion to real install
```

---

# 5. Profile Definition

Each profile is a declarative deployment unit.

## 5.1 Example: `profiles/minimal.yaml`

```yaml
id: minimal
description: Safe baseline profile with rules only.

targets:
  - claude
  - codex
  - cursor

includes:
  rules:
    - common

  skills: []

  agents: []

  hooks: []

  mcp: []

settings:
  scope: project
  allow_mcp: false
  hook_profile: none
  require_dry_run_first: true
  write_scope: project-only
```

## 5.2 Example: `profiles/developer.yaml`

```yaml
id: developer
description: Daily development profile for coding, review, and verification.

targets:
  - claude
  - codex
  - cursor

includes:
  rules:
    - common
    - coding-standards
    - testing

  skills:
    - tdd-workflow
    - verification-loop
    - code-review

  agents:
    - planner
    - code-reviewer
    - tdd-guide

  hooks:
    - pre-command-risk-check
    - post-edit-quality-gate

  mcp: []

excludes:
  hooks:
    - continuous-background-observer
    - governance-capture

settings:
  scope: project
  allow_mcp: false
  hook_profile: standard
  require_dry_run_first: true
  write_scope: project-local
```

## 5.3 Example: `profiles/security.yaml`

```yaml
id: security
description: Defensive profile for security-sensitive coding workflows.

targets:
  - claude
  - codex

includes:
  rules:
    - common
    - security
    - secure-coding
    - dependency-risk

  skills:
    - security-review
    - threat-modeling
    - dependency-audit
    - verification-loop

  agents:
    - security-reviewer
    - code-reviewer
    - planner

  hooks:
    - pre-command-risk-check
    - secret-scan
    - config-protection
    - post-edit-quality-gate

  mcp: []

settings:
  scope: project
  allow_mcp: false
  hook_profile: strict
  require_dry_run_first: true
  write_scope: project-only
  block_global_install: true
```

## 5.4 Example: `profiles/document-ai.yaml`

```yaml
id: document-ai
description: Profile for iterative court-document extraction template engineering.

targets:
  - claude
  - codex

includes:
  rules:
    - common
    - data-governance
    - pii-handling
    - schema-discipline
    - extraction-quality

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
    - confidence-escalation
    - audit-log-capture

  mcp: []

settings:
  scope: project
  allow_mcp: false
  hook_profile: validation
  require_audit_log: true
  require_dry_run_first: true
  write_scope: project-only
```

---

# 6. Profile Matrix

|Profile|Purpose|Rules|Skills|Agents|Hooks|MCP|Default scope|
|---|---|--:|--:|--:|--:|--:|---|
|`minimal`|Safe baseline|Yes|No|No|No|No|Project|
|`developer`|Daily coding|Yes|Yes|Yes|Light|No|Project|
|`security`|Defensive coding|Yes|Yes|Yes|Strict|No|Project|
|`research`|Exploration and research|Yes|Yes|Yes|Light|Optional|Project|
|`document-ai`|Extraction workflow|Yes|Yes|Yes|Validation/audit|No|Project|
|`enterprise`|Governed deployment|Yes|Yes|Yes|Strict/audit|Allowlisted only|Controlled|

---

# 7. Installer CLI Contract

The installer should expose three core commands:

```bash
agent-harness plan
agent-harness apply
agent-harness uninstall
```

## 7.1 Plan command

```bash
agent-harness plan \
  --profile developer \
  --target claude \
  --home ./sandbox/home \
  --project-root ./sandbox/project \
  --target-root ./sandbox/home/.claude \
  --state-dir ./sandbox/state \
  --json
```

Expected behavior:

- Validates profile schema.
    
- Resolves modules.
    
- Checks conflicts.
    
- Produces install plan.
    
- Writes nothing unless `--write-plan` is provided.
    

## 7.2 Apply command

```bash
agent-harness apply \
  --profile developer \
  --target claude \
  --home ./sandbox/home \
  --project-root ./sandbox/project \
  --target-root ./sandbox/home/.claude \
  --state-dir ./sandbox/state
```

Expected behavior:

- Re-generates or loads install plan.
    
- Verifies destination paths are inside allowed root.
    
- Applies file copies and JSON merges.
    
- Writes install-state registry.
    
- Produces summary report.
    

## 7.3 Uninstall command

```bash
agent-harness uninstall \
  --state ./sandbox/state/install-state.json
```

Expected behavior:

- Reads install-state file.
    
- Deletes managed files.
    
- Restores backed-up files if needed.
    
- Removes empty managed directories.
    
- Leaves unmanaged user files untouched.
    

---

# 8. Install Plan Schema

The install plan is the core deployment artifact.

```ts
type InstallPlan = {
  tool: string;
  version: string;

  profileId: string;
  target: "claude" | "codex" | "cursor" | "gemini" | "opencode";

  scope: "project" | "user" | "sandbox";

  homeDir: string;
  projectRoot: string;
  targetRoot: string;
  statePath: string;

  modules: ResolvedModule[];
  operations: InstallOperation[];

  conflicts: Conflict[];
  warnings: string[];

  safety: {
    dryRunRequired: boolean;
    globalInstallAllowed: boolean;
    mcpAllowed: boolean;
    allDestinationsInsideAllowedRoots: boolean;
  };
};
```

## 8.1 Operation types

```ts
type InstallOperation =
  | {
      kind: "copy-file";
      moduleId: string;
      source: string;
      destination: string;
      overwrite: false;
      ownership: "managed";
    }
  | {
      kind: "merge-json";
      moduleId: string;
      source: string;
      destination: string;
      mergeStrategy: "deep-merge";
      ownership: "managed";
    }
  | {
      kind: "create-directory";
      moduleId: string;
      destination: string;
      ownership: "managed";
    };
```

## 8.2 Conflict object

```ts
type Conflict = {
  destination: string;
  reason:
    | "file-exists"
    | "outside-allowed-root"
    | "unmanaged-file"
    | "profile-conflict"
    | "mcp-not-allowed"
    | "global-install-blocked";

  severity: "warning" | "error";
  resolution?: string;
};
```

---

# 9. Install State Registry

Every successful installation must write an install-state file.

```json
{
  "tool": "agent-harness",
  "version": "0.1.0",
  "profile": "developer",
  "target": "claude",
  "scope": "sandbox",
  "installedAt": "2026-05-17T00:00:00Z",

  "homeDir": "./sandbox/home",
  "projectRoot": "./sandbox/project",
  "targetRoot": "./sandbox/home/.claude",

  "files": [
    {
      "moduleId": "rules/common",
      "path": "./sandbox/home/.claude/rules/common/CLAUDE.md",
      "hash": "sha256:..."
    }
  ],

  "jsonMerges": [
    {
      "moduleId": "hooks/post-edit-quality-gate",
      "path": "./sandbox/home/.claude/settings.json",
      "backupPath": "./sandbox/state/backups/settings.json.bak"
    }
  ],

  "hooks": [
    "pre-command-risk-check",
    "post-edit-quality-gate"
  ],

  "rollback": [
    {
      "action": "delete",
      "path": "./sandbox/home/.claude/rules/common/CLAUDE.md"
    }
  ]
}
```

---

# 10. Isolation Strategy

## 10.1 Level 1: Dry-run isolation

No files are written.

```bash
agent-harness plan \
  --profile developer \
  --target claude \
  --home ./sandbox/home \
  --project-root ./sandbox/project \
  --dry-run
```

Use this for:

- profile review,
    
- CI validation,
    
- pull request checks,
    
- security review.
    

---

## 10.2 Level 2: Fake home directory

Install into a fake home.

```bash
agent-harness apply \
  --profile developer \
  --target claude \
  --home ./sandbox/home \
  --project-root ./sandbox/project \
  --target-root ./sandbox/home/.claude
```

Expected output:

```text
sandbox/home/
  .claude/
    rules/
    skills/
    agents/
    hooks/
    install-state.json
```

---

## 10.3 Level 3: Container isolation

Use Docker for clean-machine validation.

```dockerfile
FROM node:22-bookworm

WORKDIR /app
COPY . .

RUN npm install

ENV HOME=/tmp/fake-home
RUN mkdir -p /tmp/fake-home /tmp/fake-project

CMD ["npm", "test"]
```

Run:

```bash
docker build -t agent-harness-test .
docker run --rm agent-harness-test
```

---

## 10.4 Level 4: Git worktree isolation

Use a disposable worktree for full manual testing.

```bash
git worktree add ../agent-harness-test main
cd ../agent-harness-test

mkdir -p .sandbox/home
mkdir -p .sandbox/project

agent-harness apply \
  --profile developer \
  --target claude \
  --home .sandbox/home \
  --project-root .sandbox/project
```

---

# 11. Path Safety Rules

The installer must reject any write outside the allowed root.

## 11.1 Allowed roots

For sandbox testing:

```text
./sandbox/home
./sandbox/project
./sandbox/state
```

For project-scoped install:

```text
./.agent-harness
./.claude
./.cursor
./.codex
```

For user-scoped install:

```text
~/.claude
~/.codex
~/.opencode
~/.qwen
```

User-scoped install must require:

```bash
--scope user
```

and should not be allowed for high-risk profiles unless explicitly approved.

## 11.2 Mandatory path check

Every destination path must pass:

```ts
function assertInsideAllowedRoot(destination: string, allowedRoots: string[]) {
  const resolvedDestination = path.resolve(destination);

  const isAllowed = allowedRoots.some(root => {
    const resolvedRoot = path.resolve(root);
    return resolvedDestination.startsWith(resolvedRoot + path.sep);
  });

  if (!isAllowed) {
    throw new Error(`Unsafe destination outside allowed roots: ${destination}`);
  }
}
```

---

# 12. Testing Requirements

## 12.1 Unit tests

|Test|Purpose|
|---|---|
|`profile-parse.test.ts`|Every profile conforms to schema.|
|`module-resolution.test.ts`|Includes/excludes resolve correctly.|
|`plan-generation.test.ts`|Install plan is deterministic.|
|`path-safety.test.ts`|No operation writes outside allowed root.|
|`conflict-detection.test.ts`|Existing unmanaged files are detected.|

## 12.2 Integration tests

|Test|Purpose|
|---|---|
|`install-minimal.test.ts`|Minimal profile installs into fake home.|
|`install-developer.test.ts`|Developer profile installs expected rules, skills, agents, hooks.|
|`install-security.test.ts`|Security profile blocks unsafe MCP/global writes.|
|`install-document-ai.test.ts`|Document AI profile installs extraction workflow assets.|
|`uninstall.test.ts`|Managed files can be removed cleanly.|
|`rollback.test.ts`|Backed-up merged configs can be restored.|

## 12.3 Snapshot tests

Each profile should have a saved install-plan snapshot:

```text
test/snapshots/
  minimal/install-plan.json
  developer/install-plan.json
  security/install-plan.json
  document-ai/install-plan.json
```

When a profile changes, the diff must show:

- added files,
    
- removed files,
    
- changed hook set,
    
- changed MCP config,
    
- changed target path,
    
- changed permissions.
    

---

# 13. CI/CD Pipeline

## 13.1 Pull request checks

Every PR must run:

```bash
npm run validate:profiles
npm run test:unit
npm run test:integration
npm run test:snapshots
npm run security:scan
```

## 13.2 Required CI stages

```text
Stage 1: Schema validation
Stage 2: Unit tests
Stage 3: Install plan generation
Stage 4: Sandbox apply
Stage 5: Snapshot comparison
Stage 6: Uninstall validation
Stage 7: Security scan
Stage 8: Release package build
```

## 13.3 Deployment promotion

A profile can be marked production-ready only if:

```text
[ ] Profile schema valid
[ ] Install plan deterministic
[ ] Sandbox install successful
[ ] Uninstall successful
[ ] No writes outside allowed root
[ ] No unmanaged overwrite
[ ] No MCP enabled unless allowlisted
[ ] Snapshot reviewed
[ ] Security review passed
```

---

# 14. Security Controls

## 14.1 Default deny

The default profile behavior should be:

```yaml
allow_mcp: false
allow_background_hooks: false
allow_global_install: false
allow_shell_execution_hooks: false
```

Profiles must explicitly enable higher-risk features.

## 14.2 MCP controls

MCP configs must be disabled unless:

```yaml
settings:
  allow_mcp: true
  allowed_mcp_servers:
    - context7
    - github
```

The installer must reject MCP servers not on the allowlist.

## 14.3 Hook controls

Hooks should be categorized:

```text
safe:
  - documentation-warning
  - post-edit-quality-gate

medium:
  - pre-command-risk-check
  - config-protection

high:
  - shell-execution-hook
  - background-observer
  - governance-capture
  - networked-mcp-health-check
```

Enterprise and government profiles should disable high-risk hooks by default.

## 14.4 Secret handling

The installer must never write real secrets into config files.

Allowed:

```json
{
  "env": {
    "GITHUB_TOKEN": "${GITHUB_TOKEN}"
  }
}
```

Not allowed:

```json
{
  "env": {
    "GITHUB_TOKEN": "ghp_real_token_here"
  }
}
```

---

# 15. Rollback and Uninstall

Every install must be reversible.

## 15.1 Managed files

Managed files can be deleted during uninstall.

```json
{
  "action": "delete",
  "path": "./sandbox/home/.claude/rules/common/CLAUDE.md"
}
```

## 15.2 Merged files

For merged JSON files, the installer must create backups.

```json
{
  "action": "restore",
  "path": "./sandbox/home/.claude/settings.json",
  "backupPath": "./sandbox/state/backups/settings.json.bak"
}
```

## 15.3 Uninstall rule

The uninstaller must never delete files it did not create or track.

---

# 16. Deployment Phases

## Phase 0: Local design

Deliverables:

```text
profiles/minimal.yaml
profiles/developer.yaml
schemas/profile.schema.json
installer/plan.ts
```

Success criteria:

```text
[ ] Profiles validate
[ ] Plan command works
[ ] No apply command yet
```

---

## Phase 1: Sandbox installer

Deliverables:

```text
installer/apply.ts
installer/uninstall.ts
test/integration/install-minimal.test.ts
test/integration/uninstall.test.ts
```

Success criteria:

```text
[ ] Install writes only to sandbox
[ ] Install-state file generated
[ ] Uninstall removes managed files
```

---

## Phase 2: Profile expansion

Deliverables:

```text
profiles/security.yaml
profiles/document-ai.yaml
profiles/research.yaml
test/snapshots/
```

Success criteria:

```text
[ ] All profiles produce deterministic plans
[ ] Snapshot diffs are reviewable
[ ] Security profile blocks MCP by default
```

---

## Phase 3: Real project-scoped install

Deliverables:

```text
--scope project
--target claude
--target codex
```

Success criteria:

```text
[ ] Can install into ./.claude or ./.agent-harness
[ ] No global write
[ ] Project-specific uninstall works
```

---

## Phase 4: Controlled user-scope install

Deliverables:

```text
--scope user
explicit approval prompt
backup support
rollback support
```

Success criteria:

```text
[ ] User-global install requires explicit flag
[ ] Backups created
[ ] Uninstall tested
```

---

## Phase 5: Enterprise hardening

Deliverables:

```text
signed release package
dependency lockfile
security scan
audit log
allowlisted MCP registry
profile approval workflow
```

Success criteria:

```text
[ ] Install package reproducible
[ ] Profile changes require review
[ ] High-risk hooks require explicit approval
[ ] Audit log generated
```

---

# 17. Recommended MVP Scope

Start small.

## MVP profiles

```text
minimal
developer
document-ai
```

## MVP targets

```text
claude
codex
```

## MVP features

```text
plan
apply
uninstall
sandbox install
install-state registry
snapshot testing
path safety
```

## Defer until later

```text
MCP installation
background observers
global user install
GitHub App integration
dashboard UI
automatic profile upgrade
remote plugin marketplace
```

---

# 18. Acceptance Criteria

The deployment system is acceptable when the following are true:

```text
[ ] A profile can be installed into ./sandbox/home without touching real home.
[ ] A dry-run plan shows every operation before writing.
[ ] Every destination path is checked against allowed roots.
[ ] Every install writes an install-state registry.
[ ] Every install can be uninstalled.
[ ] Existing unmanaged files are not overwritten.
[ ] MCP configs are disabled by default.
[ ] User-global installation requires explicit --scope user.
[ ] CI validates all profiles.
[ ] Snapshot diffs make profile changes reviewable.
```

---

# 19. Strategic Principle

The deployment philosophy should be:

> Agent behavior is infrastructure.  
> Infrastructure must be profiled, tested, isolated, audited, and reversible.

This means your agent harness should not be a folder of prompts. It should be a controlled deployment system with profiles, install plans, test environments, state tracking, and rollback.

That is what turns Claude Code configuration from personal hacking into a professional, enterprise-ready agentic engineering framework.