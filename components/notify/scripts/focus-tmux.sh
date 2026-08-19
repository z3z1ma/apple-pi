#!/usr/bin/env bash
set -euo pipefail

# This script runs from terminal-notifier's -execute when a notification is
# clicked. That happens in a minimal launchd context: no $TMUX, no interactive
# $PATH, and not attached to any tmux client. Two consequences drive this
# script's design:
#
#   1. tmux may live outside Homebrew (e.g. nix-darwin at
#      /run/current-system/sw/bin). Preserve the inherited PATH and add the
#      common locations rather than replacing PATH with a fixed list, and honor
#      an absolute TMUX_BIN passed in by the extension.
#   2. switch-client has no "current" client to act on, so it must be given an
#      explicit client via -c. select-window / select-pane act on the global
#      @window / %pane ids regardless of the calling client.
export PATH="/opt/homebrew/bin:/usr/local/bin:/run/current-system/sw/bin:$HOME/.nix-profile/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

pi_home="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
log_path="$pi_home/logs/pi-focus-tmux.log"
tmux_bin="${TMUX_BIN:-}"
tmux_socket="${TMUX_SOCKET:-}"

session="${1:-}"
window_id="${2:-}"
pane_id="${3:-}"
window_index="${4:-}"

if [[ -z "$tmux_bin" || ! -x "$tmux_bin" ]]; then
  tmux_bin="$(command -v tmux || true)"
fi

log() {
  mkdir -p "$(dirname "$log_path")" 2>/dev/null || true
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >>"$log_path" 2>/dev/null || true
}

# Run tmux against the correct server socket when one was supplied.
tm() {
  if [[ -n "$tmux_socket" ]]; then
    "$tmux_bin" -S "$tmux_socket" "$@"
  else
    "$tmux_bin" "$@"
  fi
}

log "args session=${session:-<empty>} window_id=${window_id:-<empty>} pane_id=${pane_id:-<empty>} window_index=${window_index:-<empty>} tmux_bin=${tmux_bin:-<none>} socket=${tmux_socket:-<default>}"

/usr/bin/osascript -e 'tell application id "com.mitchellh.ghostty" to activate' >/dev/null 2>&1 || true

if [[ -z "$tmux_bin" || ! -x "$tmux_bin" ]]; then
  log "abort no tmux executable"
  exit 0
fi

tmux_target_exists() {
  [[ -n "${1:-}" ]] && tm display-message -p -t "$1" '#{session_name}' >/dev/null 2>&1
}

# Move the front client to a session. With no attached client in this context,
# resolve one explicitly from the server and pass it with -c.
focus_client() {
  local target_session="$1"
  if [[ -z "$target_session" ]]; then
    log "focus_client abort empty session"
    return 1
  fi
  local client
  client="$(tm list-clients -F '#{client_name}' 2>/dev/null | head -1 || true)"
  if [[ -n "$client" ]]; then
    if tm switch-client -c "$client" -t "$target_session" 2>/dev/null; then
      log "switch-client client=$client session=$target_session ok"
    else
      log "switch-client client=$client session=$target_session failed"
    fi
  elif tm switch-client -t "$target_session" 2>/dev/null; then
    log "switch-client no-client session=$target_session ok"
  else
    log "switch-client no-client session=$target_session failed"
  fi
}

if tmux_target_exists "$pane_id"; then
  target_session="$(tm display-message -p -t "$pane_id" '#{session_id}' 2>/dev/null || printf '%s' "$session")"
  focus_client "$target_session"
  if tm select-window -t "$pane_id" 2>/dev/null; then
    log "select-window pane_id=$pane_id ok"
  elif [[ -n "$window_id" ]] && tm select-window -t "$window_id" 2>/dev/null; then
    log "select-window window_id=$window_id ok"
  else
    log "select-window failed pane_id=$pane_id window_id=${window_id:-<empty>}"
  fi
  if tm select-pane -t "$pane_id" 2>/dev/null; then
    log "select-pane pane_id=$pane_id ok"
  else
    log "select-pane pane_id=$pane_id failed"
  fi
  exit 0
fi

if tmux_target_exists "$window_id"; then
  target_session="$(tm display-message -p -t "$window_id" '#{session_id}' 2>/dev/null || printf '%s' "$session")"
  focus_client "$target_session"
  if tm select-window -t "$window_id" 2>/dev/null; then
    log "select-window window_id=$window_id ok"
  else
    log "select-window window_id=$window_id failed"
  fi
  exit 0
fi

if [[ -n "$session" && -n "$window_index" ]] && tm has-session -t "${session}:${window_index}" 2>/dev/null; then
  focus_client "$session"
  if tm select-window -t "${session}:${window_index}" 2>/dev/null; then
    log "select-window session_window=${session}:${window_index} ok"
  else
    log "select-window session_window=${session}:${window_index} failed"
  fi
  exit 0
fi

if [[ -n "$session" ]] && tm has-session -t "$session" 2>/dev/null; then
  focus_client "$session"
  exit 0
fi

log "no matching tmux target"
