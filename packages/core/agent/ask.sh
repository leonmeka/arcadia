#!/bin/bash
set -euo pipefail

if [[ -f "${HOME}/.arcadia.env" ]]; then
  # shellcheck disable=SC1091
  . "${HOME}/.arcadia.env"
fi

# Run a natural-language prompt through OpenCode.
exec /usr/local/bin/prompt "$@"
