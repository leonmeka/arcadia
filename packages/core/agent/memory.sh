#!/bin/bash
set -euo pipefail

# shellcheck disable=SC1091
. /usr/local/bin/arcadia-lib

if [[ -f "${HOME}/.arcadia.env" ]]; then
  # shellcheck disable=SC1091
  . "${HOME}/.arcadia.env"
fi

AGENT_DIR="${ARCADIA_HOME:-$HOME}/.agent"
WORKSPACE="${ARCADIA_WORKSPACE:-$HOME/workspace}"
PRIVATE_FILE="$AGENT_DIR/MEMORY.md"
SHARED_FILE="$WORKSPACE/.arcadia/MEMORY.md"

usage() {
  cat >&2 << 'EOF'
Usage: memory              show private memory
       memory shared       show shared memory
       memory add <text>   append to private memory
       memory shared add <text>   append to shared memory
EOF
  exit 1
}

ensure_files() {
  mkdir -p "$AGENT_DIR" "$(dirname "$SHARED_FILE")"
  touch "$PRIVATE_FILE" "$SHARED_FILE"
}

ensure_files

case "${1:-}" in
  "")
    arcadia_print_file "$PRIVATE_FILE"
    ;;
  shared)
    if [[ "${2:-}" == "add" ]]; then
      shift 2
      [[ $# -ge 1 ]] || usage
      printf -- '- %s\n' "$*" >> "$SHARED_FILE"
      echo "Updated shared memory."
    else
      arcadia_print_file "$SHARED_FILE"
    fi
    ;;
  add)
    shift
    [[ $# -ge 1 ]] || usage
    printf -- '- %s\n' "$*" >> "$PRIVATE_FILE"
    echo "Updated private memory."
    ;;
  -h|--help)
    usage
    ;;
  *)
    usage
    ;;
esac
