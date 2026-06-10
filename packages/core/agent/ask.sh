#!/bin/bash
set -euo pipefail

if [[ -f "${HOME}/.arcadia.env" ]]; then
  # shellcheck disable=SC1091
  . "${HOME}/.arcadia.env"
fi

AGENT_DIR="${ARCADIA_HOME:-$HOME}/.agent"
STATE_FILE="$AGENT_DIR/state.json"
JOURNAL_FILE="$AGENT_DIR/journal.md"
LOG_FILE="$AGENT_DIR/activity.log"
MODEL="${ARCADIA_MODEL:-anthropic/claude-sonnet-4}"
OPENCODE_ATTACH="${OPENCODE_ATTACH:-http://127.0.0.1:4096}"

if [[ $# -lt 1 ]]; then
  echo 'Usage: ask "your prompt"' >&2
  exit 1
fi

if ! command -v opencode >/dev/null 2>&1; then
  echo "opencode is not installed" >&2
  exit 1
fi

PROMPT="$*"
TIMESTAMP="$(date '+%H:%M')"
DATE_HEADER="$(date '+%A, %B %-d')"

mkdir -p "$AGENT_DIR"
touch "$JOURNAL_FILE" "$LOG_FILE"

case "$MODEL" in
  */*) OPENCODE_MODEL="$MODEL" ;;
  *) OPENCODE_MODEL="openrouter/$MODEL" ;;
esac

echo "$TIMESTAMP Started: $PROMPT" >> "$LOG_FILE"

export ASK_PROMPT="$PROMPT"
export ASK_STATE_FILE="$STATE_FILE"
export ASK_JOURNAL_FILE="$JOURNAL_FILE"
export ASK_DATE_HEADER="$DATE_HEADER"

python3 <<'PYEOF'
import json
import os
from datetime import datetime, timezone
from pathlib import Path

state_file = Path(os.environ["ASK_STATE_FILE"])
state_file.write_text(json.dumps({
    "status": "working",
    "lastTask": os.environ["ASK_PROMPT"],
    "startedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
}, indent=2))
PYEOF

cd /workspace

RUN_ARGS=(run -m "$OPENCODE_MODEL")
if curl -sf "${OPENCODE_ATTACH}/doc" >/dev/null 2>&1; then
  RUN_ARGS+=(--attach "$OPENCODE_ATTACH")
fi
RUN_ARGS+=("$PROMPT")

set +e
REPLY="$(opencode "${RUN_ARGS[@]}" 2>&1)"
EXIT_CODE=$?
set -e

if [[ $EXIT_CODE -ne 0 ]]; then
  echo "$REPLY" >&2
  exit "$EXIT_CODE"
fi

echo "$REPLY"
echo

export ASK_REPLY="$REPLY"
python3 <<'PYEOF'
import json
import os
from datetime import datetime, timezone
from pathlib import Path

prompt = os.environ["ASK_PROMPT"]
reply = os.environ.get("ASK_REPLY", "")
journal_file = Path(os.environ["ASK_JOURNAL_FILE"])
state_file = Path(os.environ["ASK_STATE_FILE"])
date_header = os.environ["ASK_DATE_HEADER"]

text = journal_file.read_text() if journal_file.exists() else ""
if f"## {date_header}" not in text:
    with journal_file.open("a") as f:
        f.write(f"\n## {date_header}\n\n")

with journal_file.open("a") as f:
    f.write(f"Asked: {prompt}\n\n")
    f.write("\n".join(reply.splitlines()[:20]))
    f.write("\n\nNext:\n- Review output in /workspace\n")

state_file.write_text(json.dumps({
    "status": "idle",
    "lastTask": prompt,
    "completedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
}, indent=2))
PYEOF

echo "$TIMESTAMP Completed: $PROMPT" >> "$LOG_FILE"
