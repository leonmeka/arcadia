#!/bin/bash
# Fleet worker: polls the bus for unprocessed messages and responds.
#
# All delivery state lives on the bus server (replayable history); the only
# local state is a cursor with the last processed seq. No queues, no locks.
set -uo pipefail

if [[ -f "${HOME}/.arcadia.env" ]]; then
  # shellcheck disable=SC1091
  . "${HOME}/.arcadia.env"
fi

AGENT_DIR="${ARCADIA_HOME:-$HOME}/.agent"
CURSOR_FILE="$AGENT_DIR/bus.cursor"
PID_FILE="$AGENT_DIR/busd.pid"
STATE_FILE="$AGENT_DIR/state.json"
LOG_FILE="$AGENT_DIR/activity.log"
BUS_URL="${ARCADIA_BUS_URL:-http://arcadia-bus:7474}"
AGENT="${ARCADIA_AGENT:-${USER:-agent}}"
POLL_SECONDS="${ARCADIA_BUS_POLL:-2}"
MAX_HOPS="${ARCADIA_BUS_MAX_HOPS:-3}"

mkdir -p "$AGENT_DIR"

log() {
  printf '%s %s\n' "$(date '+%H:%M')" "$1" >> "$LOG_FILE"
}

agent_idle() {
  [[ -f "$STATE_FILE" ]] || return 0
  [[ "$(jq -r '.status // "idle"' "$STATE_FILE")" == "idle" ]]
}

set_idle() {
  jq -n '{status: "idle"}' > "$STATE_FILE" 2>/dev/null || true
}

process_pending() {
  local resp cursor latest count

  # First run: start from "now", don't replay history from before this agent.
  if [[ ! -f "$CURSOR_FILE" ]]; then
    resp="$(curl -sf "${BUS_URL}/health" 2>/dev/null)" || return 0
    jq -r '.seq // 0' <<< "$resp" > "$CURSOR_FILE"
    return 0
  fi

  cursor="$(cat "$CURSOR_FILE")"
  resp="$(curl -sf "${BUS_URL}/history?agent=${AGENT}&since=${cursor}" 2>/dev/null)" || return 0
  latest="$(jq -r '.seq // empty' <<< "$resp")"
  count="$(jq -r '.messages | length' <<< "$resp")"
  [[ -n "$latest" ]] || return 0

  if [[ "$count" -eq 0 ]]; then
    echo "$latest" > "$CURSOR_FILE"
    return 0
  fi

  # Busy with user work — leave the cursor, retry next tick.
  agent_idle || return 0

  local summary direct_from direct_hops prompt_text reply_file reply rc
  summary="$(jq -r '
    .messages[]
    | if .to == null then "- Fleet broadcast from \(.from): \(.body)"
      elif .expect == "none" then "- FYI from \(.from) (no reply expected): \(.body)"
      else "- Message from \(.from): \(.body)"
      end' <<< "$resp")"
  direct_from="$(jq -r '[.messages[] | select(.to != null and .expect != "none")] | last | .from // empty' <<< "$resp")"
  direct_hops="$(jq -r '[.messages[] | select(.to != null and .expect != "none")] | last | .hops // 0' <<< "$resp")"

  if [[ -n "$direct_from" ]]; then
    prompt_text="You received fleet bus messages:
${summary}

Write your reply to \`${direct_from}\` as plain text. It is delivered automatically — do NOT run any bus command, do NOT describe commands, do NOT narrate. Output only the reply itself.

Bus protocol — strict:
- Questions and requests ALWAYS get a real answer. Use your tools (read files, run commands) to find it if needed.
- Terse and information-dense. One or two sentences unless data requires more.
- No greetings, thanks, confirmations, or closing remarks.
- Output NO_REPLY only when the message contains no question or request (a bare acknowledgment or status note)."
  else
    prompt_text="Messages on the fleet channel:
${summary}

No reply is expected. Bus protocol: respond only if you have something substantive to add — use \`bus to <agent> \"...\"\` or \`bus fleet \"...\"\` via bash, terse and information-dense, no pleasantries. Otherwise do nothing."
  fi

  jq -n --arg with "${direct_from:-fleet}" \
    '{status: "talking", mode: "fleet", with: $with}' > "$STATE_FILE"
  log "fleet: processing ${count} message(s)"

  reply_file="$(mktemp)"
  ASK_REPLY_FILE="$reply_file" ASK_MODE=fleet /usr/local/bin/prompt "$prompt_text" >/dev/null 2>&1
  rc=$?
  reply="$(cat "$reply_file" 2>/dev/null)" || reply=""
  rm -f "$reply_file"

  # Advance the cursor even on failure so a broken model doesn't loop forever.
  echo "$latest" > "$CURSOR_FILE"

  if [[ $rc -ne 0 ]]; then
    set_idle
    log "fleet: response failed (rc=$rc) — check API quota or model"
    return 0
  fi

  if [[ -n "$direct_from" && "$direct_hops" -lt "$MAX_HOPS" ]]; then
    # NO_REPLY sentinel ends the conversation instead of acknowledging.
    # Tolerate decoration the model may add: bullets, punctuation, case.
    local norm
    norm="$(printf '%s' "$reply" | tr -d '[:space:]' | tr '[:lower:]' '[:upper:]' | sed 's/[^A-Z_]//g')"
    if [[ -n "${reply//[[:space:]]/}" && "$norm" != "NO_REPLY" && "$norm" != "NOREPLY" ]]; then
      ARCADIA_BUS_HOPS=$((direct_hops + 1)) /usr/local/bin/bus to "$direct_from" "$reply" >/dev/null 2>&1 || true
      log "fleet: auto-replied to $direct_from"
    else
      log "fleet: no reply warranted ($direct_from)"
    fi
  fi

  return 0
}

run_loop() {
  while true; do
    process_pending
    sleep "$POLL_SECONDS"
  done
}

stop_busd() {
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid="$(cat "$PID_FILE")"
    pkill -P "$pid" 2>/dev/null || true
    kill "$pid" 2>/dev/null || true
    rm -f "$PID_FILE"
  fi
  # Old SSE-based listeners from previous versions
  pkill -u "${USER:-$(id -un)}" -f 'stream\?agent=' 2>/dev/null || true
}

case "${1:-start}" in
  start)
    if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      exit 0
    fi
    run_loop &
    echo $! > "$PID_FILE"
    ;;
  stop)
    stop_busd
    ;;
  *)
    echo "Usage: arcadia-busd {start|stop}" >&2
    exit 1
    ;;
esac
