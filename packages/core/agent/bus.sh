#!/bin/bash
set -euo pipefail

if [[ -f "${HOME}/.arcadia.env" ]]; then
  # shellcheck disable=SC1091
  . "${HOME}/.arcadia.env"
fi

BUS_URL="${ARCADIA_BUS_URL:-http://arcadia-bus:7474}"
AGENT="${ARCADIA_AGENT:-${USER:-agent}}"
LOG_FILE="${ARCADIA_HOME:-$HOME}/.agent/activity.log"

# Shared display format for watch/log.
JQ_FORMAT='
  if .from == $self then
    "  → \(.to // "fleet"): \(.body)"
  elif .to == null then
    "  ← \(.from) (fleet): \(.body)"
  elif .expect == "none" then
    "  ← \(.from) (fyi): \(.body)"
  else
    "  ← \(.from): \(.body)"
  end'

usage() {
  cat >&2 << 'EOF'
Usage: bus to <agent> <message>    direct message (peer replies)
       bus fyi <agent> <message>   direct message, no reply expected
       bus fleet <message>         broadcast to all agents
       bus log [n]                 show recent fleet traffic (default 20)
       bus watch                   stream fleet traffic live (Ctrl+C to stop)
EOF
  exit 1
}

publish() {
  local expect="$1"
  local to="$2"
  shift 2
  local body="$*"
  local hops="${ARCADIA_BUS_HOPS:-0}"
  local payload

  if [[ -z "${body//[[:space:]]/}" ]]; then
    echo "bus: message required" >&2
    exit 1
  fi

  if [[ "$to" == "fleet" || "$to" == "@" || "$to" == "*" ]]; then
    payload="$(jq -nc --arg from "$AGENT" --arg body "$body" --argjson hops "$hops" \
      '{from: $from, to: null, body: $body, hops: $hops, expect: "none"}')"
  else
    to="$(printf '%s' "$to" | tr '[:upper:]' '[:lower:]')"
    payload="$(jq -nc --arg from "$AGENT" --arg to "$to" --arg body "$body" \
      --argjson hops "$hops" --arg expect "$expect" \
      '{from: $from, to: $to, body: $body, hops: $hops, expect: $expect}')"
  fi

  if ! curl -sf -X POST "${BUS_URL}/publish" \
    -H "content-type: application/json" \
    -d "$payload" >/dev/null; then
    echo "bus: publish failed (is arcadia-bus running?)" >&2
    exit 1
  fi

  mkdir -p "$(dirname "$LOG_FILE")"
  if [[ "$to" == "fleet" || "$to" == "@" || "$to" == "*" ]]; then
    printf '%s bus fleet: %s\n' "$(date '+%H:%M')" "$body" >> "$LOG_FILE"
    # Inside the arcadia shell the watch stream echoes the send already.
    if [[ -z "${ARCADIA_SHELL:-}" ]]; then
      echo "Broadcast to fleet"
    fi
  else
    printf '%s bus to %s: %s\n' "$(date '+%H:%M')" "$to" "$body" >> "$LOG_FILE"
    if [[ -z "${ARCADIA_SHELL:-}" ]]; then
      echo "Sent to $to"
    fi
  fi
}

watch_loop() {
  local line
  while true; do
    while IFS= read -r line; do
      [[ "$line" == data:* ]] || continue
      jq -r --arg self "$AGENT" "$JQ_FORMAT" <<< "${line#data: }" 2>/dev/null || true
    done < <(curl -sN "${BUS_URL}/stream?watch=${AGENT}" 2>/dev/null)
    sleep 2
  done
}

show_log() {
  local n="${1:-20}"
  curl -sf "${BUS_URL}/history?watch=${AGENT}&since=0" 2>/dev/null \
    | jq -r --arg self "$AGENT" ".messages[] | $JQ_FORMAT" \
    | tail -n "$n"
}

[[ $# -ge 1 ]] || usage

case "$1" in
  to)
    [[ $# -ge 3 ]] || usage
    publish "reply" "$2" "${*:3}"
    ;;
  fyi)
    [[ $# -ge 3 ]] || usage
    publish "none" "$2" "${*:3}"
    ;;
  fleet|broadcast)
    shift
    [[ $# -ge 1 ]] || usage
    publish "none" "fleet" "$*"
    ;;
  watch)
    watch_loop
    ;;
  log)
    show_log "${2:-20}"
    ;;
  -h|--help)
    usage
    ;;
  *)
    usage
    ;;
esac
