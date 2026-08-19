#!/usr/bin/env bash
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

pi_home="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
log_path="$pi_home/logs/pi-focus-tmux.log"
tmux_bin="${TMUX_BIN:-/opt/homebrew/bin/tmux}"

session="${1:-}"
window_id="${2:-}"
pane_id="${3:-}"
window_index="${4:-}"

if [[ ! -x "$tmux_bin" ]]; then
  tmux_bin="$(command -v tmux || true)"
fi

log() {
  mkdir -p "$(dirname "$log_path")" 2>/dev/null || true
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >>"$log_path" 2>/dev/null || true
}

log "args session=${session:-<empty>} window_id=${window_id:-<empty>} pane_id=${pane_id:-<empty>} window_index=${window_index:-<empty>}"

/usr/bin/osascript -e 'tell application id "com.mitchellh.ghostty" to activate' >/dev/null 2>&1 || true

if [[ -z "$tmux_bin" || ! -x "$tmux_bin" ]]; then
  log "abort no tmux executable"
  exit 0
fi

tmux_target_exists() {
  [[ -n "${1:-}" ]] && "$tmux_bin" display-message -p -t "$1" '#{session_name}' >/dev/null 2>&1
}

# Bring the front client to a session, then make the exact window and pane
# active. switch-client moves the viewing client to the session; select-window
# and select-pane act on the global window/pane ids regardless of which client
# is attached, so the correct window and pane become current even when
# switch-client alone would only change the session.
#
# This script runs from terminal-notifier's -execute, which has no attached
# tmux client in its environment. switch-client with no -c has no client to act
# on and fails, which would leave the session unswitched while the global
# select-window/select-pane still succeed (right pane, wrong session). Resolve
# an explicit client and pass it with -c.
focus_client() {
  local target_session="$1"
  if [[ -z "$target_session" ]]; then
    log "focus_client abort empty session"
    return 1
  fi
  local client
  client="$("$tmux_bin" list-clients -F '#{client_name}' 2>/dev/null | head -1)"
  if [[ -n "$client" ]]; then
    if "$tmux_bin" switch-client -c "$client" -t "$target_session" 2>/dev/null; then
      log "switch-client client=$client session=$target_session ok"
    else
      log "switch-client client=$client session=$target_session failed"
    fi
  elif "$tmux_bin" switch-client -t "$target_session" 2>/dev/null; then
    log "switch-client no-client session=$target_session ok"
  else
    log "switch-client no-client session=$target_session failed"
  fi
}

if tmux_target_exists "$pane_id"; then
  target_session="$("$tmux_bin" display-message -p -t "$pane_id" '#{session_id}' 2>/dev/null || printf '%s' "$session")"
  focus_client "$target_session"
  if "$tmux_bin" select-window -t "$pane_id" 2>/dev/null; then
    log "select-window pane_id=$pane_id ok"
  elif [[ -n "$window_id" ]] && "$tmux_bin" select-window -t "$window_id" 2>/dev/null; then
    log "select-window window_id=$window_id ok"
  else
    log "select-window failed pane_id=$pane_id window_id=${window_id:-<empty>}"
  fi
  if "$tmux_bin" select-pane -t "$pane_id" 2>/dev/null; then
    log "select-pane pane_id=$pane_id ok"
  else
    log "select-pane pane_id=$pane_id failed"
  fi
  exit 0
fi

if tmux_target_exists "$window_id"; then
  target_session="$("$tmux_bin" display-message -p -t "$window_id" '#{session_id}' 2>/dev/null || printf '%s' "$session")"
  focus_client "$target_session"
  if "$tmux_bin" select-window -t "$window_id" 2>/dev/null; then
    log "select-window window_id=$window_id ok"
  else
    log "select-window window_id=$window_id failed"
  fi
  exit 0
fi

if [[ -n "$session" && -n "$window_index" ]] && "$tmux_bin" has-session -t "${session}:${window_index}" 2>/dev/null; then
  focus_client "$session"
  if "$tmux_bin" select-window -t "${session}:${window_index}" 2>/dev/null; then
    log "select-window session_window=${session}:${window_index} ok"
  else
    log "select-window session_window=${session}:${window_index} failed"
  fi
  exit 0
fi

if [[ -n "$session" ]] && "$tmux_bin" has-session -t "$session" 2>/dev/null; then
  focus_client "$session"
  exit 0
fi

log "no matching tmux target"
