#!/bin/bash
set -uo pipefail

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
    status|journal|timeline|inbox|send|bus) return 1 ;;
    journal\ *) return 1 ;;
    send\ *) return 1 ;;
    bus\ *) return 1 ;;
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
  printf '\n'
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
}

arcadia_fleet_file() {
  printf '%s/.arcadia/fleet.json' "$ARCADIA_ROOT"
}

arcadia_extract_quoted() {
  local line="$1"
  if [[ "$line" =~ \"([^\"]*)\" ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
  fi
}

arcadia_resolve_agent() {
  local name="$1"
  local fleet_file agent
  name="$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]')"
  fleet_file="$(arcadia_fleet_file)"
  [[ -f "$fleet_file" ]] || return 1

  if jq -e --arg a "$name" '.agents | index($a)' "$fleet_file" >/dev/null 2>&1; then
    printf '%s' "$name"
    return 0
  fi

  while IFS= read -r agent; do
    [[ -n "$agent" ]] || continue
    if [[ "$agent" == "$name"* || "$name" == "$agent"* ]]; then
      printf '%s' "$agent"
      return 0
    fi
  done < <(jq -r '.agents[]' "$fleet_file" 2>/dev/null)

  return 1
}

arcadia_find_agent_in_text() {
  local lower="$1"
  local self="${ARCADIA_AGENT:-${USER:-agent}}"
  local fleet_file agent
  fleet_file="$(arcadia_fleet_file)"
  [[ -f "$fleet_file" ]] || return 1

  while IFS= read -r agent; do
    [[ -n "$agent" && "$agent" != "$self" ]] || continue
    if [[ "$lower" == *" $agent "* || "$lower" == *" $agent" || "$lower" == "$agent "* || "$lower" == *"to $agent"* || "$lower" == *"to $agent,"* ]]; then
      printf '%s' "$agent"
      return 0
    fi
  done < <(jq -r '.agents[]' "$fleet_file" 2>/dev/null)

  if [[ "$lower" =~ to[[:space:]]+([a-z][a-z0-9-]*) ]]; then
    arcadia_resolve_agent "${BASH_REMATCH[1]}"
    return $?
  fi

  return 1
}

# Route natural-language fleet messaging to bus without invoking the AI.
arcadia_try_bus_route() {
  local line="$1"
  local trimmed lower msg agent self="${ARCADIA_AGENT:-${USER:-agent}}"

  trimmed="${line#"${line%%[![:space:]]*}"}"
  trimmed="${trimmed%"${trimmed##*[![:space:]]}"}"
  lower="$(printf '%s' "$trimmed" | tr '[:upper:]' '[:lower:]')"
  msg="$(arcadia_extract_quoted "$trimmed")"

  if [[ ! -f "$(arcadia_fleet_file)" ]] || ! command -v bus >/dev/null 2>&1; then
    return 1
  fi

  if [[ "$lower" == *"fleet channel"* || "$lower" == *"fleet bus"* || "$lower" == *"broadcast to fleet"* || "$lower" == *"message the fleet"* || "$lower" == *"message in the fleet"* ]]; then
    if [[ -n "$msg" ]]; then
      bus fleet "$msg"
      return 0
    fi
    echo "arcadia: what should the fleet message say? (example: bus fleet \"hello everyone\")" >&2
    return 0
  fi

  if [[ "$lower" =~ (^|[[:space:]])(message|tell|write|send|ask|notify|ping)([[:space:]]|$) ]]; then
    agent="$(arcadia_find_agent_in_text " $lower ")"

    if [[ -n "$agent" && -n "$msg" ]]; then
      bus to "$agent" "$msg"
      return 0
    fi

    if [[ -n "$agent" && -z "$msg" ]]; then
      echo "arcadia: what should I send to ${agent}? (example: bus to ${agent} \"hello\")" >&2
      return 0
    fi

    if [[ -z "$agent" && -n "$msg" && "$lower" == *"fleet"* ]]; then
      bus fleet "$msg"
      return 0
    fi
  fi

  if [[ -n "$msg" ]] && [[ "$lower" =~ (^|[[:space:]])(write|say)([[:space:]]|$) ]]; then
    agent="$(arcadia_find_agent_in_text " $lower ")"
    if [[ -n "$agent" ]]; then
      bus to "$agent" "$msg"
      return 0
    fi
    if [[ "$lower" == *"fleet"* ]]; then
      bus fleet "$msg"
      return 0
    fi
  fi

  return 1
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

  # Orphaned tool processes from a killed prompt
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

# Marks bus sends as shell-originated so `bus` stays quiet (the watch stream
# echoes them) while headless callers still get confirmations.
export ARCADIA_SHELL=1

AGENT_DIR="${ARCADIA_HOME:-$HOME}/.agent"
PENDING_MAIL="${AGENT_DIR}/mail-pending"
ARCADIA_STATE_FILE="${AGENT_DIR}/state.json"
BUSD_PID_FILE="${AGENT_DIR}/busd.pid"
FLEET_TALK_SHOWN=0
ARCADIA_WATCH_PID=""

arcadia_busd_alive() {
  [[ -f "$BUSD_PID_FILE" ]] && kill -0 "$(cat "$BUSD_PID_FILE")" 2>/dev/null
}

arcadia_agent_talking() {
  [[ -f "$ARCADIA_STATE_FILE" ]] || return 1
  local status mode
  status="$(jq -r '.status // "idle"' "$ARCADIA_STATE_FILE" 2>/dev/null)" || return 1
  mode="$(jq -r '.mode // empty' "$ARCADIA_STATE_FILE" 2>/dev/null)" || mode=""

  if [[ "$status" == "talking" ]]; then
    if ! arcadia_busd_alive; then
      jq -n '{status: "idle"}' > "$ARCADIA_STATE_FILE" 2>/dev/null || true
      return 1
    fi
    return 0
  fi
  [[ "$status" == "working" && "$mode" == "fleet" ]]
}

arcadia_block_if_talking() {
  if arcadia_agent_talking; then
    printf 'arcadia: busy on the fleet channel — wait for the conversation to finish\n' >&2
    return 0
  fi
  return 1
}

arcadia_check_mail() {
  [[ -f "$PENDING_MAIL" ]] || return 0
  rm -f "$PENDING_MAIL"
  if command -v inbox >/dev/null 2>&1; then
    printf '\n--- incoming message ---\n' >&2
    inbox
    printf '\n' >&2
  fi
}

arcadia_shell_cleanup() {
  if [[ -n "$ARCADIA_WATCH_PID" ]]; then
    pkill -P "$ARCADIA_WATCH_PID" 2>/dev/null || true
    kill "$ARCADIA_WATCH_PID" 2>/dev/null || true
  fi
}

# Fleet traffic streams live into the terminal while the user is at the prompt.
if command -v bus >/dev/null 2>&1; then
  bus watch >&2 &
  ARCADIA_WATCH_PID=$!
fi

trap arcadia_shell_cleanup EXIT
trap arcadia_handle_int INT

while true; do
  arcadia_check_mail

  if arcadia_agent_talking; then
    if [[ "$FLEET_TALK_SHOWN" -eq 0 ]]; then
      printf '\n--- fleet (talking) ---\n' >&2
      FLEET_TALK_SHOWN=1
    fi
    sleep 0.5
    continue
  fi
  if [[ "$FLEET_TALK_SHOWN" -eq 1 ]]; then
    FLEET_TALK_SHOWN=0
    printf '\n' >&2
  fi

  line=""
  read -er -p "${PS1:-arcadia\$ }" line
  rc=$?
  if (( rc != 0 )); then
    # >128 means interrupted by a signal (Ctrl+C); plain failure is EOF.
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

  if arcadia_try_bus_route "$line"; then
    continue
  fi

  if [[ "$line" == :* ]]; then
    arcadia_block_if_talking && continue
    line="${line:1}"
    line="${line#"${line%%[![:space:]]*}"}"
    arcadia_invoke prompt "$line"
    arcadia_after_prompt
    continue
  fi

  if arcadia_is_prompt "$line"; then
    arcadia_block_if_talking && continue
    arcadia_invoke prompt "$line"
    arcadia_after_prompt
  else
    arcadia_run_command "$line"
  fi
done
