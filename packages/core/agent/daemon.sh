#!/bin/bash
set -euo pipefail

AGENT_DIR="${ARCADIA_HOME:-$HOME}/.agent"
STATE_FILE="$AGENT_DIR/state.json"
PID_FILE="$AGENT_DIR/daemon.pid"
LOG_FILE="$AGENT_DIR/activity.log"
OPENCODE_PORT="${OPENCODE_PORT:-4096}"
OPENCODE_ATTACH="${OPENCODE_ATTACH:-http://127.0.0.1:${OPENCODE_PORT}}"

# Load secrets for non-interactive starts (e.g. su -c during provisioning)
if [[ -f "${HOME}/.arcadia.env" ]]; then
  # shellcheck disable=SC1091
  . "${HOME}/.arcadia.env"
fi

mkdir -p "$AGENT_DIR"
touch "$AGENT_DIR/journal.md" "$LOG_FILE"

log_activity() {
  echo "$(date '+%H:%M') $1" >> "$LOG_FILE"
}

init_state() {
  # -s: treat an empty file (e.g. from touch) as uninitialized
  if [[ ! -s "$STATE_FILE" ]]; then
    cat > "$STATE_FILE" <<EOF
{
  "status": "idle",
  "lastTask": null,
  "startedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
  fi
}

start_daemon() {
  init_state

  if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    :
  else
    if ! command -v opencode >/dev/null 2>&1; then
      echo "opencode is not installed" >&2
      exit 1
    fi

    cd "${ARCADIA_WORKSPACE:-$HOME/workspace}"
    opencode serve --port "$OPENCODE_PORT" --hostname 127.0.0.1 >/dev/null 2>&1 &
    echo $! > "$PID_FILE"
    log_activity "OpenCode daemon started on ${OPENCODE_ATTACH}"
  fi

  if command -v arcadia-busd >/dev/null 2>&1; then
    arcadia-busd start
  fi

  if command -v arcadia-maild >/dev/null 2>&1; then
    arcadia-maild start
  fi
}

stop_daemon() {
  if command -v arcadia-busd >/dev/null 2>&1; then
    arcadia-busd stop
  fi

  if command -v arcadia-maild >/dev/null 2>&1; then
    arcadia-maild stop
  fi

  if [[ -f "$PID_FILE" ]]; then
    kill "$(cat "$PID_FILE")" 2>/dev/null || true
    rm -f "$PID_FILE"
    log_activity "OpenCode daemon stopped"
  fi
}

case "${1:-start}" in
  start) start_daemon ;;
  stop) stop_daemon ;;
  *) echo "Usage: arcadia-daemon {start|stop}" >&2; exit 1 ;;
esac
