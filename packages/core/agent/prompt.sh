#!/bin/bash
set -euo pipefail

if [[ -f "${HOME}/.arcadia.env" ]]; then
  # shellcheck disable=SC1091
  . "${HOME}/.arcadia.env"
fi

AGENT_DIR="${ARCADIA_HOME:-$HOME}/.agent"
STATE_FILE="$AGENT_DIR/state.json"
SESSION_FILE="$AGENT_DIR/session.json"
LOG_FILE="$AGENT_DIR/activity.log"
MODEL="${ARCADIA_MODEL:-anthropic/claude-sonnet-4}"
OPENCODE_ATTACH="${OPENCODE_ATTACH:-http://127.0.0.1:4096}"

if [[ $# -lt 1 ]]; then
  echo "Usage: prompt \"your task\"" >&2
  exit 1
fi

if ! command -v opencode >/dev/null 2>&1; then
  echo "opencode is not installed" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is not installed" >&2
  exit 1
fi

PROMPT="$*"
TIMESTAMP="$(date '+%H:%M')"
REPLY_FILE_EXTERNAL=0
if [[ -n "${ASK_REPLY_FILE:-}" ]]; then
  REPLY_FILE="$ASK_REPLY_FILE"
  REPLY_FILE_EXTERNAL=1
else
  REPLY_FILE="$(mktemp)"
fi
EVENT_FIFO="$(mktemp -u)"
mkfifo "$EVENT_FIFO"

mkdir -p "$AGENT_DIR"
touch "$LOG_FILE"

case "$MODEL" in
  */*) OPENCODE_MODEL="$MODEL" ;;
  *) OPENCODE_MODEL="openrouter/$MODEL" ;;
esac

echo "$TIMESTAMP Started: $PROMPT" >> "$LOG_FILE"

export ASK_PROMPT="$PROMPT"
export ASK_STATE_FILE="$STATE_FILE"
export ASK_LOG_FILE="$LOG_FILE"
export ASK_REPLY_FILE="$REPLY_FILE"
export ASK_SESSION_FILE="$SESSION_FILE"
export OPENCODE_ATTACH

SESSION_ARGS=()
if [[ -f "$SESSION_FILE" ]]; then
  saved_session="$(jq -r '.sessionID // empty' "$SESSION_FILE" 2>/dev/null)" || saved_session=""
  if [[ -n "$saved_session" ]]; then
    SESSION_ARGS+=(--session "$saved_session")
  else
    SESSION_ARGS+=(--continue)
  fi
fi

jq -n \
  --arg task "$PROMPT" \
  --arg started "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{status: "working", lastTask: $task, activity: "starting", startedAt: $started}' \
  > "$STATE_FILE"

cd "${ARCADIA_WORKSPACE:-$HOME/workspace}"

RUN_ARGS=(
  run
  -m "$OPENCODE_MODEL"
  --thinking
  --dangerously-skip-permissions
)
if curl -sf "${OPENCODE_ATTACH}/doc" >/dev/null 2>&1; then
  RUN_ARGS+=(--attach "$OPENCODE_ATTACH")
fi
if [[ ${#SESSION_ARGS[@]} -gt 0 ]]; then
  RUN_ARGS+=("${SESSION_ARGS[@]}")
fi
RUN_ARGS+=("$PROMPT")

: > "$REPLY_FILE"

CURL_PID=""
STREAM_PID=""
OPENCODE_PID=""
PROMPT_DONE=0

prompt_cleanup() {
  [[ "$PROMPT_DONE" -eq 1 ]] && return 0
  stop_children() {
    [[ -n "$OPENCODE_PID" ]] && kill -INT "$OPENCODE_PID" 2>/dev/null || true
    [[ -n "$STREAM_PID" ]] && kill -INT "$STREAM_PID" 2>/dev/null || true
    [[ -n "$CURL_PID" ]] && kill -INT "$CURL_PID" 2>/dev/null || true
  }
  stop_children
  sleep 0.1
  stop_children
  [[ -n "$OPENCODE_PID" ]] && pkill -TERM -P "$OPENCODE_PID" 2>/dev/null || true
  [[ -n "$OPENCODE_PID" ]] && kill -TERM "$OPENCODE_PID" 2>/dev/null || true
  [[ -n "$STREAM_PID" ]] && kill -TERM "$STREAM_PID" 2>/dev/null || true
  [[ -n "$CURL_PID" ]] && kill -TERM "$CURL_PID" 2>/dev/null || true
  pkill -TERM -u "${USER:-$(id -un)}" -f 'opencode run' 2>/dev/null || true
  wait "$OPENCODE_PID" 2>/dev/null || true
  wait "$STREAM_PID" 2>/dev/null || true
  wait "$CURL_PID" 2>/dev/null || true
  rm -f "$EVENT_FIFO"
  [[ "$REPLY_FILE_EXTERNAL" -eq 0 ]] && rm -f "$REPLY_FILE"
  jq -n \
    --arg task "$PROMPT" \
    --arg interrupted "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '{status: "idle", lastTask: $task, interruptedAt: $interrupted}' \
    > "$STATE_FILE" 2>/dev/null || true
  echo "$TIMESTAMP Interrupted: $PROMPT" >> "$LOG_FILE"
  PROMPT_DONE=1
  exit 130
}

trap prompt_cleanup INT TERM

curl -sfN "${OPENCODE_ATTACH}/global/event" > "$EVENT_FIFO" &
CURL_PID=$!

/usr/local/bin/arcadia-stream < "$EVENT_FIFO" &
STREAM_PID=$!

sleep 0.15

set +e
opencode "${RUN_ARGS[@]}" >/dev/null 2>&1 &
OPENCODE_PID=$!
wait "$OPENCODE_PID"
EXIT_CODE=$?
OPENCODE_PID=""
set -e

sleep 0.25
kill "$CURL_PID" 2>/dev/null || true
wait "$CURL_PID" 2>/dev/null || true
wait "$STREAM_PID" 2>/dev/null || true
rm -f "$EVENT_FIFO"
CURL_PID=""
STREAM_PID=""
PROMPT_DONE=1
trap - INT TERM

REPLY=""
if [[ -f "$REPLY_FILE" ]]; then
  REPLY="$(cat "$REPLY_FILE")"
fi

if [[ $EXIT_CODE -ne 0 ]]; then
  jq -n \
    --arg task "$PROMPT" \
    --arg failed "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '{status: "idle", lastTask: $task, failedAt: $failed}' \
    > "$STATE_FILE"
  [[ "$REPLY_FILE_EXTERNAL" -eq 0 ]] && rm -f "$REPLY_FILE"
  exit "$EXIT_CODE"
fi

jq -n \
  --arg task "$PROMPT" \
  --arg completed "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{status: "idle", lastTask: $task, completedAt: $completed}' \
  > "$STATE_FILE"

[[ "$REPLY_FILE_EXTERNAL" -eq 0 ]] && rm -f "$REPLY_FILE"
echo "$TIMESTAMP Completed: $PROMPT" >> "$LOG_FILE"
