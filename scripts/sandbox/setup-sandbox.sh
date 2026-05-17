#!/usr/bin/env bash
# instantiated from sandbox skill v1.0
# scripts/sandbox/setup-sandbox.sh
#
# Provision an isolated git-worktree sandbox with port-shifted infra,
# driven by .sandbox/sandbox.config.sh. Reads no values from this file —
# all knobs come from the config.
#
# Usage:
#   scripts/sandbox/setup-sandbox.sh [--no-llm] [--dry-run] [<plan-file> [<branch>]]
#
# --no-llm    Strip API keys from sandbox ENV_FILE (commented out).
# --dry-run   Print every action (incl. generated docker-compose.sandbox.yml
#             and proposed ENV_FILE edits) without executing anything.
#             Used by the skill's Phase 0 diff-test.

set -euo pipefail

# ---------- locate config ----------
MAIN_REPO="$(cd "$(dirname "$0")/../.." && pwd)"
CONFIG_FILE="$MAIN_REPO/.sandbox/sandbox.config.sh"

if [[ ! -r "$CONFIG_FILE" ]]; then
  echo "ERROR: sandbox config not found at $CONFIG_FILE" >&2
  echo "  Run the skill's install.sh first:" >&2
  echo "  bash ~/.claude/skills/sandbox/references/install.sh" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$CONFIG_FILE"

# ---------- validate required knobs (generic invariants 1, 2, 3) ----------
require_var() {
  local name=$1
  if [[ -z "${!name:-}" ]]; then
    echo "ERROR: required config knob '$name' is unset in $CONFIG_FILE" >&2
    exit 1
  fi
}
SANDBOX_MODE="${SANDBOX_MODE:-full}"

if [[ "$SANDBOX_MODE" == "worktree-only" ]]; then
  # Minimal required knobs for git-worktree + tmux only.
  for v in SANDBOX_PROJECT_NAME SANDBOX_DIR_SUFFIX; do
    require_var "$v"
  done
else
  for v in SANDBOX_PROJECT_NAME SANDBOX_DIR_SUFFIX ENV_FILE \
           DOCKER_NETWORK_NAME DOCKER_NETWORK_SUBNET DOCKER_NETWORK_ORIGINAL_NAME; do
    require_var "$v"
  done

  # Generic invariant 3 — refuse to touch *test* env files.
  if [[ "$ENV_FILE" == *test* || "$ENV_FILE" == *.ci ]]; then
    echo "ERROR: ENV_FILE='$ENV_FILE' looks like a test/CI file — refusing." >&2
    echo "  The sandbox skill must not auto-edit test credentials." >&2
    exit 1
  fi
fi

# ---------- arg parsing ----------
NO_LLM=0
DRY_RUN=0
POSITIONAL=()
for arg in "$@"; do
  case "$arg" in
    --no-llm)   NO_LLM=1 ;;
    --dry-run)  DRY_RUN=1 ;;
    *)          POSITIONAL+=("$arg") ;;
  esac
done
set -- "${POSITIONAL[@]:-}"

PLAN_FILE="${1:-}"
BRANCH="${2:-}"

if [[ -z "$PLAN_FILE" ]]; then
  echo "ERROR: plan file argument required" >&2
  exit 1
fi
if [[ -z "$BRANCH" ]]; then
  BRANCH="feature/$(basename "${PLAN_FILE%.*}")"
fi

# ---------- derived ----------
SANDBOX_DIR="${MAIN_REPO}${SANDBOX_DIR_SUFFIX}"
COMPOSE_PROJECT="$SANDBOX_PROJECT_NAME"
TMUX_SESSION="$SANDBOX_PROJECT_NAME"
SANDBOX_OVERRIDE="docker-compose.sandbox.yml"

# Helper to run a command unless --dry-run.
run() {
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "[dry-run] $*"
  else
    "$@"
  fi
}

# ---------- preflight ----------
cd "$MAIN_REPO"

if [[ ! -f "$PLAN_FILE" ]]; then
  echo "ERROR: plan file not found: $PLAN_FILE" >&2
  exit 1
fi

REQUIRED_CMDS=(git tmux)
[[ "$SANDBOX_MODE" != "worktree-only" ]] && REQUIRED_CMDS+=(docker)
for cmd in "${REQUIRED_CMDS[@]}"; do
  command -v "$cmd" >/dev/null || { echo "ERROR: $cmd not found in PATH" >&2; exit 1; }
done

if [[ -e "$SANDBOX_DIR" ]]; then
  echo "ERROR: sandbox path already exists: $SANDBOX_DIR" >&2
  echo "  Run scripts/sandbox/teardown-sandbox.sh first." >&2
  exit 1
fi

if tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
  echo "ERROR: tmux session '$TMUX_SESSION' already exists." >&2
  echo "  tmux kill-session -t $TMUX_SESSION" >&2
  exit 1
fi

if [[ "$SANDBOX_MODE" != "worktree-only" ]]; then
  # Verify port-rewrite "new" ports are free.
  for triple in "${PORT_REWRITES[@]:-}"; do
    IFS=':' read -r _label _old new <<<"$triple"
    if (echo > /dev/tcp/127.0.0.1/$new) >/dev/null 2>&1; then
      echo "ERROR: port $new is already in use (rewrite '$triple')." >&2
      exit 1
    fi
  done

  # Verify docker subnet does not overlap with existing networks.
  if docker network ls --format '{{.Name}}' | grep -qFx "$DOCKER_NETWORK_NAME"; then
    echo "ERROR: docker network '$DOCKER_NETWORK_NAME' already exists." >&2
    echo "  docker network rm $DOCKER_NETWORK_NAME  (after teardown)" >&2
    exit 1
  fi
fi

# ---------- 1. worktree ----------
SANDBOX_BASE_REF="${SANDBOX_BASE_REF:-main}"
echo "==> Creating worktree at $SANDBOX_DIR on $BRANCH (base: $SANDBOX_BASE_REF)"
if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  run git worktree add "$SANDBOX_DIR" "$BRANCH"
else
  run git worktree add -b "$BRANCH" "$SANDBOX_DIR" "$SANDBOX_BASE_REF"
fi

[[ $DRY_RUN -eq 0 ]] && cd "$SANDBOX_DIR"

if [[ "$SANDBOX_MODE" == "worktree-only" ]]; then
  echo "==> SANDBOX_MODE=worktree-only — skipping env-file rewrite, compose, infra, migration"
fi

# ---------- 2. env file (port-shifted, credentials preserved) ----------
if [[ "$SANDBOX_MODE" != "worktree-only" ]]; then
echo "==> Writing port-shifted $ENV_FILE (preserving credentials)"
if [[ $DRY_RUN -eq 0 ]]; then
  cp "$MAIN_REPO/$ENV_FILE" "$ENV_FILE"
fi

SED_ARGS=()
for expr in "${SED_REWRITES[@]:-}"; do
  SED_ARGS+=("-e" "$expr")
done
if [[ ${#SED_ARGS[@]} -gt 0 ]]; then
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "[dry-run] sed -i ${SED_ARGS[*]} $ENV_FILE"
  else
    sed -i "${SED_ARGS[@]}" "$ENV_FILE"
  fi
fi

# Append sandbox-only settings.
APPEND_BLOCK="
# --- sandbox overrides (added by setup-sandbox.sh) ---
COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT}"
if [[ -n "${QUEUE_PREFIX_ENV_VAR:-}" && -n "${QUEUE_PREFIX_VALUE:-}" ]]; then
  APPEND_BLOCK+="
${QUEUE_PREFIX_ENV_VAR}=${QUEUE_PREFIX_VALUE}"
fi

if [[ $DRY_RUN -eq 1 ]]; then
  echo "[dry-run] append to $ENV_FILE:"
  echo "$APPEND_BLOCK" | sed 's/^/  | /'
else
  printf '%s\n' "$APPEND_BLOCK" >> "$ENV_FILE"
fi

# Generic invariant 2 — queue prefix required if config declares one.
if [[ -n "${QUEUE_PREFIX_ENV_VAR:-}" && -z "${QUEUE_PREFIX_VALUE:-}" ]]; then
  echo "ERROR: QUEUE_PREFIX_ENV_VAR set but QUEUE_PREFIX_VALUE is empty." >&2
  exit 1
fi

# Optional: strip LLM API keys for unattended runs.
if [[ $NO_LLM -eq 1 && ${#LLM_KEY_VARS[@]} -gt 0 ]]; then
  echo "==> --no-llm: commenting out API keys in $ENV_FILE"
  KEY_SED_ARGS=()
  for k in "${LLM_KEY_VARS[@]}"; do
    KEY_SED_ARGS+=("-e" "s|^\\(${k}=\\)|# SANDBOX_NO_LLM \\1|")
  done
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "[dry-run] sed -i ${KEY_SED_ARGS[*]} $ENV_FILE"
  else
    sed -i "${KEY_SED_ARGS[@]}" "$ENV_FILE"
  fi
fi

# ---------- 3. compose override ----------
echo "==> Writing $SANDBOX_OVERRIDE"
COMPOSE_OVERRIDE_BODY="# Auto-generated by scripts/sandbox/setup-sandbox.sh
# Chained with: $(printf -- '-f %s ' "${COMPOSE_FILES[@]}")-f $SANDBOX_OVERRIDE
# Overrides ports, container names, AND the network so the sandbox cannot
# collide with the main dev environment.
services:"

for mapping in "${COMPOSE_PORT_OVERRIDES[@]:-}"; do
  IFS=':' read -r service label <<<"$mapping"
  # find new port for this label
  for triple in "${PORT_REWRITES[@]:-}"; do
    IFS=':' read -r tl _old new <<<"$triple"
    if [[ "$tl" == "$label" ]]; then
      # internal container port: derive from existing compose; default to old.
      IFS=':' read -r _ old _ <<<"$triple"
      COMPOSE_OVERRIDE_BODY+="
  ${service}:
    container_name: ${COMPOSE_PROJECT}-${service}
    # !override replaces the merged ports list — without it, Compose appends
    # the new mapping alongside the dev one, causing a port-bind collision.
    ports: !override
      - \"${new}:${old}\""
      break
    fi
  done
done

COMPOSE_OVERRIDE_BODY+="

networks:
  ${DOCKER_NETWORK_ORIGINAL_NAME}:
    name: ${DOCKER_NETWORK_NAME}
    ipam:
      config:
        - subnet: ${DOCKER_NETWORK_SUBNET}
"

if [[ $DRY_RUN -eq 1 ]]; then
  echo "[dry-run] write $SANDBOX_OVERRIDE:"
  echo "$COMPOSE_OVERRIDE_BODY" | sed 's/^/  | /'
else
  printf '%s' "$COMPOSE_OVERRIDE_BODY" > "$SANDBOX_OVERRIDE"
fi

# ---------- 4. seed files ----------
for pair in "${SEED_FILES[@]:-}"; do
  IFS=':' read -r src dst <<<"$pair"
  if [[ -z "$src" ]]; then continue; fi
  if [[ -f "$MAIN_REPO/$src" ]]; then
    echo "==> Seeding $dst from main checkout"
    if [[ $DRY_RUN -eq 0 ]]; then
      mkdir -p "$(dirname "$dst")"
      cp "$MAIN_REPO/$src" "$dst"
    else
      echo "[dry-run] cp $MAIN_REPO/$src $dst"
    fi
  fi
done

# ---------- 5. npm install (skipped on dry-run) ----------
if [[ $DRY_RUN -eq 0 && -f package.json ]]; then
  echo "==> Installing node modules"
  npm ci --prefer-offline --no-audit --fund=false
fi

# ---------- 6. start infra ----------
COMPOSE_CMD=(docker compose -p "$COMPOSE_PROJECT")
for f in "${COMPOSE_FILES[@]}"; do
  COMPOSE_CMD+=(-f "$f")
done
COMPOSE_CMD+=(-f "$SANDBOX_OVERRIDE")

echo "==> Starting sandbox infra (project=${COMPOSE_PROJECT})"
if [[ $DRY_RUN -eq 1 ]]; then
  echo "[dry-run] ${COMPOSE_CMD[*]} up -d ${COMPOSE_SERVICES_TO_START[*]}"
else
  "${COMPOSE_CMD[@]}" up -d "${COMPOSE_SERVICES_TO_START[@]}"
fi

# Readiness checks.
for check in "${READINESS_CHECKS[@]:-}"; do
  IFS=':' read -r label host port timeout <<<"$check"
  echo "==> Waiting for $label on ${host}:${port} (timeout ${timeout}s)"
  if [[ $DRY_RUN -eq 1 ]]; then continue; fi
  for i in $(seq 1 "$timeout"); do
    if (echo > /dev/tcp/$host/$port) >/dev/null 2>&1; then
      echo "    $label up after ${i}s"; break
    fi
    sleep 1
  done
done

# ---------- 7. migration ----------
if [[ -n "${MIGRATION_COMMAND:-}" ]]; then
  echo "==> Running migration: $MIGRATION_COMMAND"
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "[dry-run] (source $ENV_FILE; $MIGRATION_COMMAND)"
  else
    ( set -a; source "$ENV_FILE"; set +a
      eval "$MIGRATION_COMMAND"
    )
  fi
fi
fi  # SANDBOX_MODE != worktree-only

# ---------- 8. tmux session ----------
if [[ $DRY_RUN -eq 1 ]]; then
  echo "[dry-run] tmux new-session -d -s $TMUX_SESSION ..."
else
  echo "==> Creating tmux session '$TMUX_SESSION'"

  tmux new-session -d -s "$TMUX_SESSION" -n orchestrator -c "$SANDBOX_DIR"
  tmux set-option -t "$TMUX_SESSION" -g remain-on-exit on
  tmux set-option -t "$TMUX_SESSION" -g mouse on
  tmux send-keys -t "$TMUX_SESSION:orchestrator" \
    "echo '--- sandbox ready. Press Enter on the next line to launch claude. ---'" C-m
  # CLAUDE_ENTRY_COMMAND uses ${SANDBOX_DIR} — substitute now.
  CLAUDE_CMD="${CLAUDE_ENTRY_COMMAND//\$\{SANDBOX_DIR\}/$SANDBOX_DIR}"
  tmux send-keys -t "$TMUX_SESSION:orchestrator" "$CLAUDE_CMD"
  # ^ no C-m: command typed but not submitted. Operator reviews + hits Enter.

  if [[ "$SANDBOX_MODE" != "worktree-only" ]]; then
    tmux new-window -t "$TMUX_SESSION" -n logs -c "$SANDBOX_DIR"
    tmux send-keys -t "$TMUX_SESSION:logs" \
      "${COMPOSE_CMD[*]} logs -f --tail=50" C-m
  fi

  tmux new-window -t "$TMUX_SESSION" -n shell -c "$SANDBOX_DIR"
  tmux send-keys -t "$TMUX_SESSION:shell" \
    "echo 'Sandbox: $SANDBOX_DIR'; echo 'Branch: $BRANCH'; echo 'Plan:   $PLAN_FILE'; git status -sb" C-m

  tmux select-window -t "$TMUX_SESSION:orchestrator"
fi

# ---------- summary ----------
LLM_NOTE=""
[[ $NO_LLM -eq 1 ]] && LLM_NOTE="  LLM keys : STRIPPED (--no-llm)
"

# Build the human-readable port summary from PORT_REWRITES.
PORT_SUMMARY=""
if [[ ${#PORT_REWRITES[@]} -gt 0 ]]; then
  for triple in "${PORT_REWRITES[@]}"; do
    IFS=':' read -r label _old new <<<"$triple"
    PORT_SUMMARY+="  ${label}: localhost:${new}
"
  done
fi

NETWORK_LINE=""
[[ "$SANDBOX_MODE" != "worktree-only" ]] && NETWORK_LINE="  Network  : ${DOCKER_NETWORK_NAME} (${DOCKER_NETWORK_SUBNET})
"

cat <<EOF

==================== SANDBOX READY ====================

  Worktree : $SANDBOX_DIR
  Branch   : $BRANCH
  Plan     : $PLAN_FILE
  Project  : ${COMPOSE_PROJECT}
  Mode     : ${SANDBOX_MODE}
${NETWORK_LINE}${PORT_SUMMARY}${LLM_NOTE}  tmux     : $TMUX_SESSION  (windows: $(IFS=' | '; echo "${TMUX_WINDOWS[*]}"))

  Attach:
      tmux attach -t $TMUX_SESSION

  In the 'orchestrator' window, claude is pre-typed but NOT submitted.
  Review the command, press Enter, then run:
      /track-orchestrator $PLAN_FILE
  (or the skill drives this for you on autonomy >= gate-on-pr)

  Teardown when done:
      $MAIN_REPO/scripts/sandbox/teardown-sandbox.sh

=======================================================
EOF
