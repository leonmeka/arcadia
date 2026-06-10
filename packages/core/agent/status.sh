#!/bin/bash
set -euo pipefail

AGENT_DIR="${ARCADIA_HOME:-$HOME}/.agent"
STATE_FILE="$AGENT_DIR/state.json"
MODEL="${ARCADIA_MODEL:-unknown}"

if [[ ! -s "$STATE_FILE" ]]; then
  echo "Status:   idle"
  echo "Model:    $MODEL"
  exit 0
fi

python3 <<PYEOF
import json
from pathlib import Path

state_path = Path("$STATE_FILE")
try:
    state = json.loads(state_path.read_text())
except (json.JSONDecodeError, OSError):
    state = {}
print(f"Status:   {state.get('status', 'idle')}")
print(f"Model:    $MODEL")
if state.get('lastTask'):
    print(f"Last:     {state['lastTask']}")
if state.get('startedAt'):
    print(f"Since:    {state['startedAt']}")
PYEOF
