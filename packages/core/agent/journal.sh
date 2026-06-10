#!/bin/bash
set -euo pipefail

AGENT_DIR="${ARCADIA_HOME:-$HOME}/.agent"
JOURNAL_FILE="$AGENT_DIR/journal.md"

mkdir -p "$AGENT_DIR"

if [[ ! -s "$JOURNAL_FILE" ]]; then
  cat > "$JOURNAL_FILE" <<EOF
## Today

Investigated:

- (nothing yet)

Created:

- (nothing yet)

Next:

- Run \`ask "your first task"\`
EOF
fi

if [[ $# -gt 0 ]]; then
  echo "$*" >> "$JOURNAL_FILE"
  echo "Updated journal."
else
  cat "$JOURNAL_FILE"
fi
