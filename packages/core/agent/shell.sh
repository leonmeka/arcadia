#!/bin/bash
set -uo pipefail

# shellcheck disable=SC1091
. /usr/local/bin/arcadia-lib

if [[ -f "${HOME}/.arcadia.env" ]]; then
  # shellcheck disable=SC1091
  . "${HOME}/.arcadia.env"
fi

ARCADIA_ROOT="${ARCADIA_WORKSPACE:-$HOME/workspace}"
LOG_FILE="${ARCADIA_HOME:-$HOME}/.agent/activity.log"

# Words that exist as shell commands but are commonly used in natural language.
AMBIGUOUS_COMMANDS=(
  help read test time find make cut kill sleep wait sort patch break
  return true false type echo get let set
)

arcadia_log() {
  mkdir -p "$(dirname "$LOG_FILE")"
  printf '%s %s\n' "$(date '+%H:%M')" "$1" >> "$LOG_FILE"
}

arcadia_resolve_path() {
  local target="${1:-.}"
  if [[ "$target" == /* ]]; then
    realpath -m "$target" 2>/dev/null || printf '%s' "$target"
  else
    realpath -m "$PWD/$target" 2>/dev/null || printf '%s' "$PWD/$target"
  fi
}

arcadia_in_workspace() {
  local path="$1"
  [[ "$path" == "$ARCADIA_ROOT_RESOLVED" || "$path" == "$ARCADIA_ROOT_RESOLVED/"* ]]
}

arcadia_ensure_cwd() {
  local cmd="${1:-}"
  local cwd
  cwd="$(arcadia_resolve_path ".")"
  if arcadia_in_workspace "$cwd"; then
    return 0
  fi
  builtin cd "$ARCADIA_ROOT" 2>/dev/null || true
  if [[ -n "$cmd" ]]; then
    arcadia_log "workspace: kept in ~/workspace (${cmd})"
  else
    arcadia_log "workspace: kept in ~/workspace"
  fi
  return 1
}

cd() {
  local target="${1:-$ARCADIA_ROOT}"
  local resolved
  resolved="$(arcadia_resolve_path "$target")"
  if arcadia_in_workspace "$resolved"; then
    builtin cd "$target"
    return $?
  fi
  arcadia_log "workspace: cd blocked (${target})"
  echo "arcadia: cannot leave ~/workspace" >&2
  return 1
}

arcadia_is_prompt() {
  local line="$1"
  local trimmed="${line#"${line%%[![:space:]]*}"}"
  trimmed="${trimmed%"${trimmed##*[![:space:]]}"}"

  [[ -z "$trimmed" ]] && return 1

  if [[ "$trimmed" == :* ]]; then
    return 0
  fi
  if [[ "$trimmed" == !* ]]; then
    return 1
  fi

  case "$trimmed" in
    status|timeline|memory) return 1 ;;
    memory\ *) return 1 ;;
  esac

  if [[ "$trimmed" =~ [\|\&\;\$\`\>\<\(] ]]; then
    return 1
  fi

  if [[ "$trimmed" =~ ^[a-zA-Z_][a-zA-Z0-9_]*= ]]; then
    return 1
  fi
  if [[ "$trimmed" =~ ^(cd|export|unset|alias|unalias|source|\.)[[:space:]] ]]; then
    return 1
  fi
  if [[ "$trimmed" =~ ^(pnpm|arcadia|docker|tsx|npm)[[:space:]] ]] || [[ "$trimmed" =~ ^(pnpm|arcadia|docker)$ ]]; then
    return 1
  fi

  if [[ "$trimmed" =~ ^(cd|pwd|clear|history|exit|logout)$ ]]; then
    return 1
  fi

  local first="${trimmed%% *}"
  local rest="${trimmed#"$first"}"
  rest="${rest# }"

  if [[ "$first" == ./* || "$first" == ../* || "$first" == /* ]]; then
    return 1
  fi

  if [[ -n "$rest" ]]; then
    local word
    for word in "${AMBIGUOUS_COMMANDS[@]}"; do
      if [[ "$first" == "$word" ]]; then
        return 0
      fi
    done
  fi

  if command -v "$first" >/dev/null 2>&1; then
    return 1
  fi

  return 0
}

arcadia_after_prompt() {
  arcadia_ensure_cwd "prompt" || true
  arcadia_newline_before_prompt
}

arcadia_run_command() {
  local line="$1"
  if [[ "$line" == !* ]]; then
    line="${line:1}"
    line="${line#"${line%%[![:space:]]*}"}"
  fi
  # shellcheck disable=SC2086
  eval "$line"
  arcadia_ensure_cwd "$line" || true
  arcadia_newline_before_prompt
}

mkdir -p "$ARCADIA_ROOT"
ARCADIA_ROOT_RESOLVED="$(arcadia_resolve_path "$ARCADIA_ROOT")"
builtin cd "$ARCADIA_ROOT"

ARCADIA_BUSY=0
ARCADIA_ACTIVE_PID=""
ARCADIA_INT_COUNT=0
ARCADIA_INT_LAST=0
ARCADIA_EXIT_WINDOW=2

arcadia_kill_tree() {
  local pid="$1"
  local child
  [[ -n "$pid" ]] || return 0
  for child in $(ps -o pid= --ppid "$pid" 2>/dev/null); do
    child="${child// /}"
    if [[ -n "$child" && "$child" != "$$" ]]; then
      arcadia_kill_tree "$child"
    fi
  done
  kill -INT "$pid" 2>/dev/null || true
}

arcadia_kill_active() {
  local pid="$1"
  local pgid=""
  [[ -n "$pid" ]] || return 1

  arcadia_kill_tree "$pid"

  pgid="$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')"
  if [[ -n "$pgid" && "$pgid" != "$$" ]]; then
    kill -INT -"$pgid" 2>/dev/null || true
  fi

  sleep 0.15
  kill -TERM "$pid" 2>/dev/null || true
  pkill -TERM -P "$pid" 2>/dev/null || true
  if [[ -n "$pgid" && "$pgid" != "$$" ]]; then
    kill -TERM -"$pgid" 2>/dev/null || true
  fi

  pkill -TERM -u "${USER:-$(id -un)}" -f 'opencode run' 2>/dev/null || true
  pkill -TERM -u "${USER:-$(id -un)}" -f 'arcadia-stream' 2>/dev/null || true

  wait "$pid" 2>/dev/null || true

  jq -n '{status: "idle"}' > "${ARCADIA_HOME:-$HOME}/.agent/state.json" 2>/dev/null || true
}

arcadia_handle_int() {
  if [[ "$ARCADIA_BUSY" -eq 1 ]]; then
    if [[ -n "$ARCADIA_ACTIVE_PID" ]]; then
      arcadia_kill_active "$ARCADIA_ACTIVE_PID"
      ARCADIA_ACTIVE_PID=""
    fi
    ARCADIA_BUSY=0
    ARCADIA_INT_COUNT=0
    printf '\narcadia: interrupted\n' >&2
    return 0
  fi

  local now=$SECONDS
  if (( now - ARCADIA_INT_LAST > ARCADIA_EXIT_WINDOW )); then
    ARCADIA_INT_COUNT=0
  fi
  ARCADIA_INT_COUNT=$((ARCADIA_INT_COUNT + 1))
  ARCADIA_INT_LAST=$now

  if (( ARCADIA_INT_COUNT >= 2 )); then
    printf '\n' >&2
    exit 130
  fi

  printf '\narcadia: press Ctrl+C again to exit\n' >&2
}

arcadia_invoke() {
  ARCADIA_BUSY=1
  if declare -f "$1" >/dev/null 2>&1; then
    ( "$@" ) &
  elif command -v setsid >/dev/null 2>&1 && command -v "$1" >/dev/null 2>&1; then
    setsid "$@" &
  else
    "$@" &
  fi
  ARCADIA_ACTIVE_PID=$!
  wait "$ARCADIA_ACTIVE_PID" 2>/dev/null || true
  ARCADIA_ACTIVE_PID=""
  ARCADIA_BUSY=0
  ARCADIA_INT_COUNT=0
}

arcadia_is_host_command() {
  local line="$1"
  [[ "$line" =~ ^(pnpm|arcadia|docker|tsx|node)[[:space:]] ]] && return 0
  [[ "$line" == "pnpm" || "$line" == "arcadia" || "$line" == "docker" ]] && return 0
  return 1
}

trap arcadia_handle_int INT

while true; do
  line=""
  read -er -p "${PS1:-arcadia\$ }" line
  rc=$?
  if (( rc != 0 )); then
    if (( rc > 128 )); then
      continue
    fi
    printf '\n' >&2
    break
  fi

  [[ -z "${line//[[:space:]]/}" ]] && continue
  ARCADIA_INT_COUNT=0

  case "$line" in
    exit|logout)
      break
      ;;
  esac

  if arcadia_is_host_command "$line"; then
    echo "arcadia: that is a host command — run it on your machine, not inside the agent" >&2
    echo "arcadia: to leave the agent, type exit or press Ctrl+C twice" >&2
    continue
  fi

  if [[ "$line" == :* ]]; then
    line="${line:1}"
    line="${line#"${line%%[![:space:]]*}"}"
    arcadia_invoke prompt "$line"
    arcadia_after_prompt
    continue
  fi

  if arcadia_is_prompt "$line"; then
    arcadia_invoke prompt "$line"
    arcadia_after_prompt
  else
    arcadia_run_command "$line"
  fi
done
