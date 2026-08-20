#!/usr/bin/env bash
# Shared helpers for the Pi tmux session manager.
#
# Adapted from tmux-claude-session-manager (MIT, Takuya Matsuyama). Status here
# comes from JSON records the Pi extension writes to disk rather than from a
# `claude agents --json` command.

# get_tmux_option <option-name> <default>
# Echoes the global tmux option value, or the default when unset/empty.
get_tmux_option() {
  local value
  value="$(tmux show-option -gqv "$1" 2>/dev/null)"
  if [ -n "$value" ]; then
    printf '%s' "$value"
  else
    printf '%s' "$2"
  fi
}

# session_hash <string>
# Short, stable, portable 8-char hash for deriving a session name from a path.
# Prefers md5sum (Linux), falls back to md5 (macOS) then shasum.
session_hash() {
  local out
  if command -v md5sum >/dev/null 2>&1; then
    out="$(printf '%s\n' "$1" | md5sum)"
  elif command -v md5 >/dev/null 2>&1; then
    out="$(printf '%s\n' "$1" | md5 -q)"
  else
    out="$(printf '%s\n' "$1" | shasum)"
  fi
  out="${out%% *}"
  printf '%s' "${out:0:8}"
}

# state_dir
# Directory the Pi extension writes session records into. Must match STATE_DIR
# in components/tmux-sessions/src/state.ts.
#
# run-shell and display-popup inherit the tmux server's environment, not the
# user's shell rc, so an env-only override (PI_TMUX_STATE_DIR / PI_CODING_AGENT_DIR
# exported for Pi) is invisible here and would silently empty the picker. The
# `@pi_state_dir` tmux option is the reliable channel: set it whenever you
# override the directory for the extension.
state_dir() {
  local opt
  opt="$(get_tmux_option @pi_state_dir '')"
  if [ -n "$opt" ]; then
    printf '%s' "$opt"
  else
    printf '%s' "${PI_TMUX_STATE_DIR:-${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/state/tmux-sessions}"
  fi
}
