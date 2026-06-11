#!/bin/bash
set -euo pipefail

# shellcheck disable=SC1091
. /usr/local/bin/arcadia-lib

AGENT_DIR="${ARCADIA_HOME:-$HOME}/.agent"
LOG_FILE="$AGENT_DIR/activity.log"

mkdir -p "$AGENT_DIR"
touch "$LOG_FILE"

if [[ ! -s "$LOG_FILE" ]]; then
  echo "No activity yet."
  exit 0
fi

arcadia_ensure_trailing_newline "$LOG_FILE"
tail -30 "$LOG_FILE"
