#!/usr/bin/env bash
# Pi agent sidebar: one tmux pane that follows the active window until it is closed.
#
#   sidebar.sh toggle <window>          prefix key: open the sidebar in <window> without focus, or close it
#   sidebar.sh follow <window>          window and session hooks: move the open sidebar into <window>
#   sidebar.sh seen <pane>              focus hook: record when the operator last looked at <pane>
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WIDTH=42

# The live sidebar pane, or nothing. Pane ids are never reused within a tmux server.
sidebar() {
  local pane
  pane="$(tmux show-option -gqv @pi_sidebar_pane)"
  [ -n "$pane" ] && tmux display-message -p -t "$pane" '#{pane_id}' 2>/dev/null
}

open() {
  if ! command -v uv >/dev/null 2>&1; then
    tmux display-message "Pi sidebar needs uv on the tmux server's PATH"
    return
  fi
  local pane
  pane="$(tmux split-window -h -f -d -l "$WIDTH" -t "$1" -P -F '#{pane_id}' \
    -e "PI_TMUX_STATE_DIR=$(tmux show-option -gqv @pi_state_dir)" \
    "uv run --script '$ROOT/sidebar/sidebar.py'")"
  tmux set-option -g @pi_sidebar_pane "$pane"
}

follow() {
  local pane="$1" window="$2"
  [ "$(tmux display-message -p -t "$pane" '#{window_id}')" = "$window" ] && return
  tmux join-pane -h -f -d -l "$(tmux display-message -p -t "$pane" '#{pane_width}')" -s "$pane" -t "$window"
}

case "${1:-}" in
toggle)
  pane="$(sidebar)"
  if [ -n "$pane" ]; then tmux kill-pane -t "$pane"; else open "$2"; fi
  ;;
follow)
  pane="$(sidebar)"
  if [ -n "$pane" ]; then follow "$pane" "$2"; fi
  ;;
seen)
  tmux set-option -p -t "$2" @pi_seen_at "$(date +%s)"
  ;;
esac
exit 0
