#!/usr/bin/env bash
# .sandbox/sandbox.config.sh — per-repo config for the sandbox skill.
#
# This repo (everything-claude-code) is a Claude Code plugin: no docker,
# no compose, no DB, no runtime services. We run the sandbox in
# `worktree-only` mode — git worktree + tmux isolation, no infra.

# ---------- mode ----------

# "full"           — original behavior (docker compose + env-file rewrite + migrations)
# "worktree-only"  — just git worktree + tmux session; skip everything docker/env/compose
SANDBOX_MODE="worktree-only"

# ---------- identity ----------

SANDBOX_PROJECT_NAME="ecc-sandbox"
SANDBOX_DIR_SUFFIX=".sandbox"

# Branch the worktree off this ref. Defaults to "main" upstream; this repo
# wants the current feature branch as the base so plan files are present.
SANDBOX_BASE_REF="HEAD"

# ---------- env file (unused in worktree-only mode) ----------

# Required by the script's preflight; ignored when SANDBOX_MODE=worktree-only.
ENV_FILE=".env.sandbox-placeholder"

# ---------- docker (unused in worktree-only mode) ----------

COMPOSE_FILES=()
COMPOSE_SERVICES_TO_START=()
DOCKER_NETWORK_NAME="ecc_sandbox_unused"
DOCKER_NETWORK_SUBNET="172.31.0.0/16"
DOCKER_NETWORK_ORIGINAL_NAME="ecc-sandbox-unused"

# ---------- port rewrites (none) ----------

PORT_REWRITES=()
SED_REWRITES=()
COMPOSE_PORT_OVERRIDES=()

# ---------- queue prefix (none) ----------

QUEUE_PREFIX_ENV_VAR=""
QUEUE_PREFIX_VALUE=""

# ---------- LLM keys ----------

LLM_KEY_VARS=("ANTHROPIC_API_KEY" "OPENAI_API_KEY" "GOOGLE_API_KEY" "GEMINI_API_KEY" "OPENROUTER_API_KEY")

# ---------- migration (none) ----------

MIGRATION_COMMAND=""

# ---------- seed files (none) ----------

SEED_FILES=()

# ---------- readiness (none) ----------

READINESS_CHECKS=()

# ---------- tmux ----------

TMUX_WINDOWS=("orchestrator" "shell")
CLAUDE_ENTRY_COMMAND="claude --dangerously-skip-permissions --add-dir \${SANDBOX_DIR}"

# ---------- per-repo overlay rules (Phase 4 review) ----------

# No wire-format triad rule in this repo. Schemas under schemas/ are the closest
# analog — surface them so reviewers flag schema/manifest drift.
TRIAD_PATHS=(
  "schemas/"
  "manifests/"
)
