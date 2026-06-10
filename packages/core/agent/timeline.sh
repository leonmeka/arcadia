#!/bin/bash
set -euo pipefail

AGENT_DIR="${ARCADIA_HOME:-$HOME}/.agent"
LOG_FILE="$AGENT_DIR/activity.log"

mkdir -p "$AGENT_DIR"
touch "$LOG_FILE"

if [[ ! -s "$LOG_FILE" ]]; then
  echo "No activity yet."
  exit 0
fi

tail -30 "$LOG_FILE"
