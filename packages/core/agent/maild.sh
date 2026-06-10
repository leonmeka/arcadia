#!/bin/bash
set -uo pipefail

if [[ -f "${HOME}/.arcadia.env" ]]; then
  # shellcheck disable=SC1091
  . "${HOME}/.arcadia.env"
fi

AGENT_DIR="${ARCADIA_HOME:-$HOME}/.agent"
PID_FILE="$AGENT_DIR/maild.pid"
PENDING_FILE="$AGENT_DIR/mail-pending"
WORKSPACE="${ARCADIA_WORKSPACE:-$HOME/workspace}"
MAIL_ROOT="$WORKSPACE/.arcadia/mailbox"
AGENT="${ARCADIA_AGENT:-${USER:-agent}}"
INBOX="$MAIL_ROOT/$AGENT/inbox"
POLL_SECS="${ARCADIA_MAIL_POLL:-2}"

mkdir -p "$AGENT_DIR" "$INBOX"

stop_maild() {
  if [[ -f "$PID_FILE" ]]; then
    kill "$(cat "$PID_FILE")" 2>/dev/null || true
    rm -f "$PID_FILE"
  fi
}

has_unread() {
  local file status
  shopt -s nullglob
  for file in "$INBOX"/*.json; do
    [[ -f "$file" ]] || continue
    status="$(jq -r '.status // "unread"' "$file")"
    if [[ "$status" == "unread" ]]; then
      shopt -u nullglob
      return 0
    fi
  done
  shopt -u nullglob
  return 1
}

shell_active() {
  ps -u "${USER:-$(id -un)}" -o args= 2>/dev/null | grep -q '[a]rcadia-shell'
}

watch_loop() {
  while true; do
    if has_unread; then
      if shell_active; then
        touch "$PENDING_FILE"
      else
        /usr/local/bin/arcadia-mail-deliver || true
      fi
    fi
    sleep "$POLL_SECS"
  done
}

case "${1:-start}" in
  start)
    if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      exit 0
    fi
    watch_loop &
    echo $! > "$PID_FILE"
    ;;
  stop)
    stop_maild
    ;;
  *)
    echo "Usage: arcadia-maild {start|stop}" >&2
    exit 1
    ;;
esac
