#!/usr/bin/env bash
# instantiated from sandbox skill v1.0
# scripts/sandbox/resume-sandbox.sh
#
# Re-attach to an existing sandbox + emit its current state so the skill can
# pick up after Claude Code is restarted, the operator's terminal died, etc.
#
# Idempotent: safe to call repeatedly. Never re-provisions.
#
# Usage:
#   resume-sandbox.sh             # print state of current sandbox + attach hint
#   resume-sandbox.sh attach      # exec into tmux attach
#   resume-sandbox.sh state       # JSON snapshot for the skill to parse

set -euo pipefail

MAIN_REPO="$(cd "$(dirname "$0")/../.." && pwd)"
CONFIG_FILE="$MAIN_REPO/.sandbox/sandbox.config.sh"
# shellcheck disable=SC1090
source "$CONFIG_FILE"

SANDBOX_DIR="${MAIN_REPO}${SANDBOX_DIR_SUFFIX}"
COMPOSE_PROJECT="$SANDBOX_PROJECT_NAME"
TMUX_SESSION="$SANDBOX_PROJECT_NAME"

worktree_exists=0
docker_up=0
tmux_alive=0

[[ -d "$SANDBOX_DIR" ]] && worktree_exists=1
docker ps --filter "label=com.docker.compose.project=${COMPOSE_PROJECT}" --format '{{.Names}}' \
  | grep -q . && docker_up=1 || true
tmux has-session -t "$TMUX_SESSION" 2>/dev/null && tmux_alive=1 || true

cmd="${1:-status}"

case "$cmd" in
  state)
    printf '{"worktree":%s,"docker":%s,"tmux":%s,"sandbox_dir":"%s","tmux_session":"%s","compose_project":"%s"}\n' \
      "$([[ $worktree_exists -eq 1 ]] && echo true || echo false)" \
      "$([[ $docker_up -eq 1 ]]    && echo true || echo false)" \
      "$([[ $tmux_alive -eq 1 ]]   && echo true || echo false)" \
      "$SANDBOX_DIR" "$TMUX_SESSION" "$COMPOSE_PROJECT"
    ;;

  attach)
    [[ $tmux_alive -eq 1 ]] || { echo "ERROR: tmux session '$TMUX_SESSION' not alive." >&2; exit 1; }
    exec tmux attach -t "$TMUX_SESSION"
    ;;

  status|*)
    cat <<EOF
Sandbox state for '$COMPOSE_PROJECT':
  worktree     : $([[ $worktree_exists -eq 1 ]] && echo "$SANDBOX_DIR" || echo "absent")
  docker stack : $([[ $docker_up -eq 1 ]] && echo "up" || echo "down")
  tmux session : $([[ $tmux_alive -eq 1 ]] && echo "$TMUX_SESSION (alive)" || echo "absent")
EOF
    if [[ $tmux_alive -eq 1 ]]; then
      echo
      echo "Attach with:  tmux attach -t $TMUX_SESSION"
    fi
    if [[ $worktree_exists -eq 1 && $docker_up -eq 0 ]]; then
      echo
      echo "WARN: worktree exists but docker stack is down — partial state."
      echo "      Either re-up the stack manually, or teardown:"
      echo "      bash $MAIN_REPO/scripts/sandbox/teardown-sandbox.sh"
    fi
    ;;
esac
