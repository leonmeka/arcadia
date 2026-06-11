#!/bin/bash
# Shared helpers for Arcadia agent scripts.

arcadia_ensure_trailing_newline() {
  local file="$1"
  [[ ! -s "$file" ]] && return 0
  local last
  last="$(tail -c1 "$file" 2>/dev/null || true)"
  [[ -n "$last" && "$last" != $'\n' ]] && printf '\n' >> "$file"
}

arcadia_print_file() {
  local file="$1"
  arcadia_ensure_trailing_newline "$file"
  [[ ! -s "$file" ]] && return 0
  cat "$file"
}

# When command output omits a trailing newline, the next prompt renders on the
# same line. Emit one only if the cursor is not already at column 1.
arcadia_newline_before_prompt() {
  [[ -t 1 && -t 0 ]] || return 0
  local _ _row _col
  printf '\033[6n' >/dev/tty
  IFS=';' read -rsd R -t 1 _ _row _col </dev/tty || return 0
  _col="${_col%R}"
  _col="${_col#*[}"
  if [[ -n "$_col" && "$_col" != 1 ]]; then
    printf '\n'
  fi
}
