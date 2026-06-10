#!/bin/bash
set -euo pipefail

if [[ -f "${HOME}/.arcadia.env" ]]; then
  # shellcheck disable=SC1091
  . "${HOME}/.arcadia.env"
fi

WORKSPACE="${ARCADIA_WORKSPACE:-$HOME/workspace}"
MAIL_ROOT="$WORKSPACE/.arcadia/mailbox"
FLEET_FILE="$WORKSPACE/.arcadia/fleet.json"
AGENT="${ARCADIA_AGENT:-${USER:-agent}}"
LOG_FILE="${ARCADIA_HOME:-$HOME}/.agent/activity.log"

if [[ $# -lt 2 ]]; then
  echo "Usage: send <agent> <message>" >&2
  exit 1
fi

to="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
shift
body="$*"

if [[ ! -f "$FLEET_FILE" ]]; then
  echo "send: fleet not configured (run arcadia enter to sync)" >&2
  exit 1
fi

if ! jq -e --arg a "$to" '.agents | index($a)' "$FLEET_FILE" >/dev/null; then
  echo "send: unknown agent '$to'" >&2
  echo "Known agents: $(jq -r '.agents | join(", ")' "$FLEET_FILE")" >&2
  exit 1
fi

if [[ "$to" == "$AGENT" ]]; then
  echo "send: cannot message yourself" >&2
  exit 1
fi

id="$(date +%s)-${AGENT}-$(head -c 4 /dev/urandom 2>/dev/null | od -An -tx1 | tr -d ' \n' || printf '%04x' $RANDOM)"
inbox="$MAIL_ROOT/$to/inbox"
mkdir -p "$inbox"

jq -n \
  --arg id "$id" \
  --arg from "$AGENT" \
  --arg to "$to" \
  --arg body "$body" \
  --arg sentAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{id: $id, from: $from, to: $to, body: $body, sentAt: $sentAt, status: "unread"}' \
  > "$inbox/$id.json"

printf '%s mail sent to %s\n' "$(date '+%H:%M')" "$to" >> "$LOG_FILE"
echo "Sent to $to"
echo "Waiting for a reply? Check inbox"
