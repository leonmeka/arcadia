#!/bin/bash
set -uo pipefail

if [[ -f "${HOME}/.arcadia.env" ]]; then
  # shellcheck disable=SC1091
  . "${HOME}/.arcadia.env"
fi

AGENT_DIR="${ARCADIA_HOME:-$HOME}/.agent"
STATE_FILE="$AGENT_DIR/state.json"
LOG_FILE="$AGENT_DIR/activity.log"
WORKSPACE="${ARCADIA_WORKSPACE:-$HOME/workspace}"
MAIL_ROOT="$WORKSPACE/.arcadia/mailbox"
AGENT="${ARCADIA_AGENT:-${USER:-agent}}"
INBOX="$MAIL_ROOT/$AGENT/inbox"

agent_idle() {
  [[ -f "$STATE_FILE" ]] || return 0
  [[ "$(jq -r '.status // "idle"' "$STATE_FILE")" == "idle" ]]
}

find_unread() {
  local file status
  shopt -s nullglob
  for file in "$INBOX"/*.json; do
    [[ -f "$file" ]] || continue
    status="$(jq -r '.status // "unread"' "$file")"
    if [[ "$status" == "unread" ]]; then
      printf '%s' "$file"
      shopt -u nullglob
      return 0
    fi
  done
  shopt -u nullglob
  return 1
}

claim_message() {
  local file="$1"
  local status
  status="$(jq -r '.status // "unread"' "$file")"
  [[ "$status" == "unread" ]] || return 1
  jq '.status = "processing"' "$file" > "${file}.tmp"
  mv "${file}.tmp" "$file"
}

deliver_one() {
  local file="$1"
  local from body prompt_text reply_file reply

  claim_message "$file" || return 1

  from="$(jq -r '.from' "$file")"
  body="$(jq -r '.body' "$file")"

  printf '%s mail from %s: %s\n' "$(date '+%H:%M')" "$from" "$(printf '%s' "$body" | head -c 80)" >> "$LOG_FILE"

  prompt_text="You received a message from agent \`${from}\`:

${body}

Respond concisely. Your reply will be delivered to \`${from}\` automatically — do not run send yourself."

  reply_file="$(mktemp)"
  export ASK_REPLY_FILE="$reply_file"

  set +e
  /usr/local/bin/prompt "$prompt_text"
  set -u
  unset ASK_REPLY_FILE

  if [[ -f "$reply_file" ]]; then
    reply="$(cat "$reply_file")"
    rm -f "$reply_file"
    if [[ -n "${reply//[[:space:]]/}" ]]; then
      /usr/local/bin/send "$from" "$reply"
      printf '%s mail reply to %s\n' "$(date '+%H:%M')" "$from" >> "$LOG_FILE"
    fi
  fi

  jq '.status = "read"' "$file" > "${file}.tmp"
  mv "${file}.tmp" "$file"
  return 0
}

# Deliver a single unread message if idle.
if ! agent_idle; then
  exit 0
fi

mkdir -p "$INBOX"
file="$(find_unread)" || exit 0
deliver_one "$file"
