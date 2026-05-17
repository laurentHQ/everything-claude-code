#!/usr/bin/env bash
# instantiated from sandbox skill v1.0
# scripts/sandbox/sandbox-status.sh
#
# Emit a JSON snapshot of the current sandbox state so the skill can parse it
# between phases. Also serves as the persistent record for resume + postmortem.
#
# Usage:
#   sandbox-status.sh init <plan-slug>           # create status file
#   sandbox-status.sh log <phase> <step> <status> <detail>
#   sandbox-status.sh tokens <phase> <input> <output>   # cost accounting
#   sandbox-status.sh snapshot                   # print current state as JSON
#   sandbox-status.sh wave-verify <N>            # run per-wave verification gate

set -euo pipefail

MAIN_REPO="$(cd "$(dirname "$0")/../.." && pwd)"
CONFIG_FILE="$MAIN_REPO/.sandbox/sandbox.config.sh"
# shellcheck disable=SC1090
[[ -r "$CONFIG_FILE" ]] && source "$CONFIG_FILE" || true

STATUS_DIR="$MAIN_REPO/.sandbox/runs"
mkdir -p "$STATUS_DIR"

cmd="${1:-snapshot}"; shift || true

case "$cmd" in
  init)
    slug="${1:?slug required}"
    file="$STATUS_DIR/${slug}.jsonl"
    : > "$file"
    printf '{"event":"init","slug":"%s","started":"%s","skill_version":"v1.0"}\n' \
      "$slug" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$file"
    # Also seed the human-readable status markdown.
    md="$MAIN_REPO/.claude/plans/${slug}-sandbox-status.md"
    mkdir -p "$(dirname "$md")"
    cat > "$md" <<EOF
# Sandbox Run — ${slug}
**Started:** $(date -u +%Y-%m-%dT%H:%M:%SZ)  **Skill:** v1.0

| Phase | Step | Status | Detail |
|---|---|---|---|
EOF
    echo "$file"
    ;;

  log)
    slug="${1:?slug required}"; phase="${2:?}"; step="${3:?}"; status="${4:?}"; detail="${5:-}"
    file="$STATUS_DIR/${slug}.jsonl"
    md="$MAIN_REPO/.claude/plans/${slug}-sandbox-status.md"
    ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '{"event":"log","ts":"%s","phase":"%s","step":"%s","status":"%s","detail":%s}\n' \
      "$ts" "$phase" "$step" "$status" "$(printf '%s' "$detail" | jq -Rs .)" >> "$file"
    printf '| %s | %s | %s | %s |\n' "$phase" "$step" "$status" "$detail" >> "$md"
    ;;

  tokens)
    slug="${1:?}"; phase="${2:?}"; tin="${3:?}"; tout="${4:?}"
    file="$STATUS_DIR/${slug}.jsonl"
    printf '{"event":"tokens","ts":"%s","phase":"%s","input":%s,"output":%s}\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$phase" "$tin" "$tout" >> "$file"
    ;;

  snapshot)
    slug="${1:?}"
    file="$STATUS_DIR/${slug}.jsonl"
    [[ -r "$file" ]] || { echo '{"error":"no_status"}'; exit 0; }
    # Aggregate: last status per phase + cumulative token count.
    jq -s '
      {
        slug: (.[0].slug // null),
        phases: (
          [ .[] | select(.event=="log") ]
          | group_by(.phase)
          | map({phase: .[0].phase, last: (max_by(.ts))})
        ),
        tokens: (
          [ .[] | select(.event=="tokens") ]
          | reduce .[] as $t ({input:0,output:0};
              .input += $t.input | .output += $t.output)
        )
      }
    ' "$file"
    ;;

  wave-verify)
    # Run the per-wave verification gate. Called by the orchestrator between waves.
    wave="${1:?wave number required}"
    slug="${2:?slug required}"
    cd "$MAIN_REPO${SANDBOX_DIR_SUFFIX}"

    failed=0

    # 1. Baseline pre-existing failures on main.
    base_failures="$(git stash -u >/dev/null 2>&1 && \
                     npm test --silent 2>&1 | grep -cE 'FAIL|✗' || true; \
                     git stash pop >/dev/null 2>&1 || true)"

    # 2. Tests on the working tree.
    if ! npm test --silent; then
      bash "$0" log "$slug" "3-wave-$wave" "test-run" "RED" "tests failed (baseline=$base_failures)"
      failed=1
    fi

    # 3. Wire-format triad guard if applicable.
    if [[ ${#TRIAD_PATHS[@]:-0} -gt 0 ]]; then
      changed=$(git diff --name-only main...HEAD)
      for p in "${TRIAD_PATHS[@]}"; do
        if echo "$changed" | grep -qF "$p"; then
          echo "==> Wave $wave touched triad path '$p' — running triad guard"
          if ! npm test --silent -- tests/unit/contract/wire-format-triad.test.ts 2>/dev/null; then
            bash "$0" log "$slug" "3-wave-$wave" "triad-guard" "RED" "triad guard failed"
            failed=1
          fi
          break
        fi
      done
    fi

    [[ $failed -eq 0 ]] && \
      bash "$0" log "$slug" "3-wave-$wave" "verify" "OK" "tests=passed triad=ok" || \
      exit 1
    ;;

  *)
    echo "Unknown command: $cmd" >&2
    echo "Usage: $0 {init|log|tokens|snapshot|wave-verify} ..." >&2
    exit 2
    ;;
esac
