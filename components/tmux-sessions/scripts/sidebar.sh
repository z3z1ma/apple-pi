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

# tmux shrinks a window's panes unevenly when the sidebar arrives and hands all the space back to the
# rightmost pane when it leaves, so splits drift left on every visit. Each window keeps the layout it had
# before the sidebar arrived and gets it back when the sidebar leaves. If the panes changed meanwhile,
# select-layout refuses the old layout and tmux's own reflow stands.
remember_layout() {
  tmux set-option -wF -t "$1" @pi_layout '#{window_layout}'
}

restore_layout() {
  local layout
  layout="$(tmux show-option -wqv -t "$1" @pi_layout)"
  [ -n "$layout" ] && tmux select-layout -t "$1" "$layout" 2>/dev/null
  tmux set-option -wu -t "$1" @pi_layout 2>/dev/null
}

open() {
  if ! command -v uv >/dev/null 2>&1; then
    tmux display-message "Pi sidebar needs uv on the tmux server's PATH"
    return
  fi
  remember_layout "$1"
  local pane
  pane="$(tmux split-window -h -f -d -l "$WIDTH" -t "$1" -P -F '#{pane_id}' \
    -e "PI_TMUX_STATE_DIR=$(tmux show-option -gqv @pi_state_dir)" \
    "uv run --script '$ROOT/sidebar/sidebar.py'")"
  tmux set-option -g @pi_sidebar_pane "$pane"
}

follow() {
  local pane="$1" window="$2" source
  source="$(tmux display-message -p -t "$pane" '#{window_id}')"
  [ "$source" = "$window" ] && return
  remember_layout "$window"
  tmux join-pane -h -f -d -l "$(tmux display-message -p -t "$pane" '#{pane_width}')" -s "$pane" -t "$window"
  restore_layout "$source"
}

close() {
  local window
  window="$(tmux display-message -p -t "$1" '#{window_id}')"
  tmux kill-pane -t "$1"
  restore_layout "$window"
}

case "${1:-}" in
toggle)
  pane="$(sidebar)"
  if [ -n "$pane" ]; then close "$pane"; else open "$2"; fi
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
