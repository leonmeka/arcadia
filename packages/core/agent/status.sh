#!/bin/bash
set -euo pipefail

AGENT_DIR="${ARCADIA_HOME:-$HOME}/.agent"
STATE_FILE="$AGENT_DIR/state.json"
MODEL="${ARCADIA_MODEL:-unknown}"
IDENTITY="${ARCADIA_IDENTITY_NAME:-}"
TEMPLATE="${ARCADIA_TEMPLATE_NAME:-agent}"

format_name() {
  local value="$1"
  value="${value//-/ }"
  value="${value//_/ }"
  local word formatted=""
  for word in $value; do
    formatted+="${word^} "
  done
  printf '%s' "${formatted%" "}"
}

if [[ -z "$IDENTITY" ]]; then
  IDENTITY="$(format_name "$TEMPLATE")"
fi

if [[ ! -s "$STATE_FILE" ]]; then
  echo "Status:   idle"
  echo "Identity: $IDENTITY"
  echo "Model:    $MODEL"
  exit 0
fi

status="$(jq -r '.status // "idle"' "$STATE_FILE")"
activity="$(jq -r '.activity // empty' "$STATE_FILE")"
last_task="$(jq -r '.lastTask // empty' "$STATE_FILE")"
started_at="$(jq -r '.startedAt // empty' "$STATE_FILE")"

echo "Status:   $status"
echo "Identity: $IDENTITY"
echo "Model:    $MODEL"
[[ -n "$activity" ]] && echo "Activity: $activity"
[[ -n "$last_task" ]] && echo "Last:     $last_task"
[[ -n "$started_at" ]] && echo "Since:    $started_at"
