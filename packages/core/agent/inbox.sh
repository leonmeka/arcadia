#!/bin/bash
set -euo pipefail

if [[ -f "${HOME}/.arcadia.env" ]]; then
  # shellcheck disable=SC1091
  . "${HOME}/.arcadia.env"
fi

WORKSPACE="${ARCADIA_WORKSPACE:-$HOME/workspace}"
MAIL_ROOT="$WORKSPACE/.arcadia/mailbox"
AGENT="${ARCADIA_AGENT:-${USER:-agent}}"
INBOX="$MAIL_ROOT/$AGENT/inbox"
SHOW_ALL=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all|-a) SHOW_ALL=1; shift ;;
    -h|--help)
      echo "Usage: inbox [--all]"
      exit 0
      ;;
    *) echo "Usage: inbox [--all]" >&2; exit 1 ;;
  esac
done

mkdir -p "$INBOX"

shopt -s nullglob
files=("$INBOX"/*.json)
shopt -u nullglob

if [[ ${#files[@]} -eq 0 ]]; then
  echo "Inbox empty."
  exit 0
fi

count=0
for file in "${files[@]}"; do
  [[ -f "$file" ]] || continue
  status="$(jq -r '.status // "unread"' "$file")"
  if [[ "$SHOW_ALL" -eq 0 && "$status" != "unread" ]]; then
    continue
  fi

  id="$(jq -r '.id' "$file")"
  from="$(jq -r '.from' "$file")"
  sent="$(jq -r '.sentAt' "$file")"
  body="$(jq -r '.body' "$file")"

  echo "From: $from  ($sent)"
  echo "$body"
  echo "---"

  if [[ "$status" == "unread" ]]; then
    jq '.status = "read"' "$file" > "${file}.tmp"
    mv "${file}.tmp" "$file"
  fi
  count=$((count + 1))
done

if [[ "$count" -eq 0 ]]; then
  echo "No unread messages."
fi
