#!/usr/bin/env bash
# instantiated from sandbox skill v1.0
# scripts/sandbox/teardown-sandbox.sh
#
# Tear down the sandbox created by setup-sandbox.sh:
#  - Kills the tmux session
#  - Stops + removes docker volumes for the sandbox project
#  - Removes the git worktree
# Leaves the feature branch in place so you can push / open a PR after teardown.

set -euo pipefail

MAIN_REPO="$(cd "$(dirname "$0")/../.." && pwd)"
CONFIG_FILE="$MAIN_REPO/.sandbox/sandbox.config.sh"

if [[ ! -r "$CONFIG_FILE" ]]; then
  echo "ERROR: sandbox config not found at $CONFIG_FILE" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$CONFIG_FILE"

SANDBOX_MODE="${SANDBOX_MODE:-full}"
SANDBOX_DIR="${MAIN_REPO}${SANDBOX_DIR_SUFFIX}"
COMPOSE_PROJECT="$SANDBOX_PROJECT_NAME"
TMUX_SESSION="$SANDBOX_PROJECT_NAME"

echo "==> Killing tmux session '$TMUX_SESSION' (if present)"
tmux kill-session -t "$TMUX_SESSION" 2>/dev/null || true

if [[ -d "$SANDBOX_DIR" ]]; then
  if [[ "$SANDBOX_MODE" != "worktree-only" ]]; then
    echo "==> Stopping docker stack (project=${COMPOSE_PROJECT}, removing volumes)"
    COMPOSE_CMD=(docker compose -p "$COMPOSE_PROJECT")
    for f in "${COMPOSE_FILES[@]}"; do
      COMPOSE_CMD+=(-f "$f")
    done
    COMPOSE_CMD+=(-f "docker-compose.sandbox.yml")

    ( cd "$SANDBOX_DIR" && "${COMPOSE_CMD[@]}" down -v 2>/dev/null || true )
  fi

  echo "==> Removing git worktree at $SANDBOX_DIR"
  cd "$MAIN_REPO"
  git worktree remove --force "$SANDBOX_DIR"
else
  echo "==> No sandbox directory at $SANDBOX_DIR (already cleaned?)"
fi

echo
echo "Done. The feature branch is preserved — push or delete it manually:"
echo "    git -C $MAIN_REPO branch -a | grep feature/"
