#!/bin/bash
set -uo pipefail

OPENCODE_ATTACH="${OPENCODE_ATTACH:-http://127.0.0.1:4096}"
ARCADIA_WORKSPACE="${ARCADIA_WORKSPACE:-${HOME}/workspace}"
LOG_FILE="${ASK_LOG_FILE:-}"
STATE_FILE="${ASK_STATE_FILE:-}"
SESSION_FILE="${ASK_SESSION_FILE:-}"
REPLY_FILE="${ASK_REPLY_FILE:-}"
USER_PROMPT="${ASK_PROMPT:-}"

DIM=$'\033[2m'
RED=$'\033[31m'
RST=$'\033[0m'
SPINNER_FRAMES=(⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏)
SPINNER_PID=""
STATIC_THINKING_PRINTED=0
SESSION_ID=""
ASSISTANT_ACTIVE=0
TOOL_COUNT=0
HAD_ERROR=0
FINAL_REPLY=""

if [[ -d "$ARCADIA_WORKSPACE" ]]; then
  ARCADIA_WORKSPACE_RESOLVED="$(realpath -m "$ARCADIA_WORKSPACE" 2>/dev/null || printf '%s' "$ARCADIA_WORKSPACE")"
else
  ARCADIA_WORKSPACE_RESOLVED="$ARCADIA_WORKSPACE"
fi

declare -A PART_TEXT
declare -A TOOL_SHOWN

log_activity() {
  [[ -n "$LOG_FILE" ]] || return 0
  printf '%s %s\n' "$(date '+%H:%M')" "$1" >> "$LOG_FILE"
}

update_state() {
  local key="$1"
  local value="$2"
  [[ -n "$STATE_FILE" ]] || return 0
  [[ -f "$STATE_FILE" ]] || echo '{}' > "$STATE_FILE"
  jq --arg k "$key" --arg v "$value" '.[$k] = $v' "$STATE_FILE" > "${STATE_FILE}.tmp"
  mv "${STATE_FILE}.tmp" "$STATE_FILE"
}

persist_session() {
  [[ -n "$SESSION_FILE" && -n "$SESSION_ID" ]] || return 0
  jq -n \
    --arg id "$SESSION_ID" \
    --arg updated "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '{sessionID: $id, updatedAt: $updated}' > "$SESSION_FILE"
}

preview() {
  local text="$1"
  local limit="${2:-120}"
  text="${text//$'\n'/ }"
  text="${text//$'\r'/ }"
  if ((${#text} <= limit)); then
    printf '%s' "$text"
  else
    printf '%s...' "${text:0:limit-3}"
  fi
}

start_spinner() {
  if [[ -n "$SPINNER_PID" ]] && kill -0 "$SPINNER_PID" 2>/dev/null; then
    return 0
  fi
  if [[ ! -t 2 ]]; then
    if [[ "$STATIC_THINKING_PRINTED" -eq 0 ]]; then
      printf '%bThinking...%b\n' "$DIM" "$RST" >&2
      STATIC_THINKING_PRINTED=1
    fi
    return 0
  fi
  (
    i=0
    while true; do
      printf '\r\033[K%b%s Thinking...%b' "$DIM" "${SPINNER_FRAMES[$((i % ${#SPINNER_FRAMES[@]}))]}" "$RST" >&2
      i=$((i + 1))
      sleep 0.08
    done
  ) &
  SPINNER_PID=$!
}

stop_spinner() {
  if [[ -n "$SPINNER_PID" ]]; then
    kill "$SPINNER_PID" 2>/dev/null || true
    wait "$SPINNER_PID" 2>/dev/null || true
    SPINNER_PID=""
  fi
  if [[ -t 2 ]]; then
    printf '\r\033[K' >&2
  fi
}

extract_part() {
  jq -c '.payload.properties.part // .payload.syncEvent.data.part // empty' <<< "$1" 2>/dev/null
}

event_session() {
  jq -r '
    .payload.properties.sessionID //
    .payload.properties.info.id //
    .payload.syncEvent.data.sessionID //
    .payload.syncEvent.aggregateID //
    empty
  ' <<< "$1" 2>/dev/null
}

matches_session() {
  local payload="$1"
  local part_session="$2"
  [[ -n "$part_session" ]] || return 1
  if [[ -n "$SESSION_ID" ]]; then
    [[ "$part_session" == "$SESSION_ID" ]]
    return
  fi
  local directory
  directory="$(jq -r '.directory // empty' <<< "$payload")"
  [[ -z "$directory" ]] && return 0
  [[ "$directory" == "$ARCADIA_WORKSPACE" || "$directory" == "/workspace" ]] && return 0
  [[ -n "${ARCADIA_WORKSPACE_RESOLVED:-}" && "$directory" == "$ARCADIA_WORKSPACE_RESOLVED" ]]
}

print_tool_line() {
  local part="$1"
  local finalize="${2:-0}"
  local tool cmd output exit_code status title path
  tool="$(jq -r '.tool // "tool"' <<< "$part")"
  title="$(jq -r '.state.title // .state.input.description // ""' <<< "$part")"
  status="$(jq -r '.state.status // ""' <<< "$part")"
  cmd="$(jq -r '.state.input.command // .state.title // .state.input.description // empty' <<< "$part")"

  case "$tool" in
    bash)
      cmd="${cmd:-${title:-"(command)"}}"
      printf '  %s%s  %s%s' "$DIM" "bash" "$cmd" "$RST"
      if [[ "$finalize" -eq 1 ]]; then
        output="$(jq -r '.state.output // ""' <<< "$part")"
        exit_code="$(jq -r '.state.metadata.exit // empty' <<< "$part")"
        if [[ "$status" == "error" ]]; then
          printf '%b  ✗ failed%b\n' "$RED" "$RST"
        elif [[ -n "$exit_code" && "$exit_code" != "0" ]]; then
          printf '%b  ✗ exit %s%b\n' "$RED" "$exit_code" "$RST"
        elif [[ -n "${output//[[:space:]]/}" ]]; then
          printf '%b  → %s%b\n' "$DIM" "$(preview "$output")" "$RST"
        else
          printf '\n'
        fi
        log_activity "bash: $cmd"
      else
        printf '\n'
        log_activity "bash: $cmd (running)"
      fi
      update_state activity "bash: $cmd"
      ;;
    read|write|edit)
      path="$(jq -r '.state.input.filePath // .state.input.path // .state.input.file // empty' <<< "$part")"
      path="${path:-$title}"
      printf '  %b%s  %s%b\n' "$DIM" "$tool" "$path" "$RST"
      log_activity "$tool: $path"
      update_state activity "$tool: $path"
      ;;
    list)
      path="$(jq -r '.state.input.path // .state.input.directory // empty' <<< "$part")"
      path="${path:-$title}"
      printf '  %b%s  %s%b\n' "$DIM" "$tool" "$path" "$RST"
      log_activity "$tool: $path"
      update_state activity "$tool: $path"
      ;;
    *)
      printf '  %b%s  %s%b\n' "$DIM" "$tool" "${title:-$tool}" "$RST"
      log_activity "$tool: ${title:-$tool}"
      update_state activity "$tool: ${title:-$tool}"
      ;;
  esac
}

handle_session_event() {
  local payload="$1"
  local event_type
  event_type="$(jq -r '.payload.type // empty' <<< "$payload")"
  if [[ "$event_type" == "session.created" ]]; then
    SESSION_ID="$(event_session "$payload")"
    persist_session
  fi
  if [[ "$event_type" == "session.error" ]]; then
    local session err
    session="$(jq -r '.payload.properties.sessionID // empty' <<< "$payload")"
    [[ -n "$SESSION_ID" && "$session" != "$SESSION_ID" ]] && return 0
    err="$(jq -r '
      .payload.properties.error.data.message //
      .payload.properties.error.name //
      empty
    ' <<< "$payload")"
    err="${err:-unknown error}"
    stop_spinner
    HAD_ERROR=1
    printf '%b✗ %s%b\n' "$RED" "$err" "$RST" >&2
    log_activity "error: $err"
    update_state activity "error: $err"
  fi
}

handle_part() {
  local payload="$1"
  local part="$2"
  local part_type part_id part_session status text old new_text ended

  part_type="$(jq -r '.type // empty' <<< "$part")"
  part_id="$(jq -r '.id // empty' <<< "$part")"
  part_session="$(jq -r '.sessionID // empty' <<< "$part")"
  if [[ -n "$part_session" ]]; then
    SESSION_ID="$part_session"
  fi
  matches_session "$payload" "$part_session" || return 0

  case "$part_type" in
    step-start)
      ASSISTANT_ACTIVE=1
      update_state activity "thinking"
      start_spinner
      ;;
    tool)
      status="$(jq -r '.state.status // ""' <<< "$part")"
      if [[ "$status" == "running" || "$status" == "pending" ]]; then
        cmd="$(jq -r '.state.input.command // empty' <<< "$part")"
        [[ -z "$cmd" ]] && return 0
        if [[ -z "${TOOL_SHOWN[$part_id]:-}" ]]; then
          stop_spinner
          TOOL_SHOWN[$part_id]=started
          TOOL_COUNT=$((TOOL_COUNT + 1))
          print_tool_line "$part" 0
          start_spinner
        fi
        return 0
      fi
      if [[ "$status" == "completed" || "$status" == "error" ]]; then
        [[ "${TOOL_SHOWN[$part_id]:-}" == "done" ]] && return 0
        stop_spinner
        if [[ "${TOOL_SHOWN[$part_id]:-}" == "started" ]]; then
          TOOL_SHOWN[$part_id]=done
          tool="$(jq -r '.tool // ""' <<< "$part")"
          if [[ "$tool" == "bash" ]]; then
            output="$(jq -r '.state.output // ""' <<< "$part")"
            exit_code="$(jq -r '.state.metadata.exit // empty' <<< "$part")"
            if [[ "$status" == "error" ]]; then
              printf '%b    ✗ failed%b\n' "$RED" "$RST"
            elif [[ -n "$exit_code" && "$exit_code" != "0" ]]; then
              printf '%b    ✗ exit %s%b\n' "$RED" "$exit_code" "$RST"
            elif [[ -n "${output//[[:space:]]/}" ]]; then
              printf '%b    → %s%b\n' "$DIM" "$(preview "$output")" "$RST"
            fi
          fi
        else
          TOOL_SHOWN[$part_id]=done
          TOOL_COUNT=$((TOOL_COUNT + 1))
          print_tool_line "$part" 1
        fi
        start_spinner
      fi
      ;;
    text)
      [[ "$ASSISTANT_ACTIVE" -eq 1 ]] || return 0
      text="$(jq -r '.text // ""' <<< "$part")"
      old="${PART_TEXT[$part_id]:-}"
      if ((${#text} > ${#old})); then
        stop_spinner
        new_text="${text:${#old}}"
        printf '%s' "$new_text"
        PART_TEXT[$part_id]="$text"
        ended="$(jq -r '.time.end // empty' <<< "$part")"
        if [[ -n "$ended" ]]; then
          printf '\n'
          FINAL_REPLY="$text"
          log_activity "response"
          update_state activity "responding"
        fi
      fi
      ;;
    reasoning)
      text="$(jq -r '.text // ""' <<< "$part")"
      if [[ -n "${text//[[:space:]]/}" ]]; then
        log_activity "thinking:"
        log_activity "$(preview "$text" 80)"
      fi
      ;;
  esac
}

process_line() {
  local line="$1"
  local payload event_type part

  [[ "$line" == data:* ]] || return 0
  payload="${line#data: }"
  event_type="$(jq -r '.payload.type // empty' <<< "$payload")"

  handle_session_event "$payload"

  if [[ "$event_type" == "message.part.updated" || "$event_type" == "sync" ]]; then
    part="$(extract_part "$payload")"
    [[ -z "$part" || "$part" == "null" ]] && return 0
    handle_part "$payload" "$part"
  fi
}

stream_cleanup() {
  stop_spinner
  exit 130
}

trap stream_cleanup INT TERM

start_spinner

while IFS= read -r line; do
  [[ -z "${line//[[:space:]]/}" ]] && continue
  process_line "$line"
done

stop_spinner

trap - INT TERM

if [[ -n "$REPLY_FILE" && -n "$FINAL_REPLY" ]]; then
  printf '%s\n' "$FINAL_REPLY" > "$REPLY_FILE"
fi

if [[ "$HAD_ERROR" -eq 0 && "$TOOL_COUNT" -gt 0 ]]; then
  log_activity "done"
fi

persist_session

exit "$HAD_ERROR"
