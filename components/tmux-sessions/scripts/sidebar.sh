#!/usr/bin/env bash
# Pi agent sidebar, dashboard, and status-line summary for tmux.
#
#   sidebar.sh toggle <window>                    prefix + u: open the sidebar in <window> without focus, or close it
#   sidebar.sh follow <window>                    window and session hooks: move the open sidebar into <window>
#   sidebar.sh jump <client>                      prefix + y: go to the agent that has needed you longest
#   sidebar.sh dashboard <client> <window> <session>   prefix + A: open, switch to, or leave the dashboard window
#   sidebar.sh status                             show the runtime's summary (@pi_agents) in the status line
set -uo pipefail
# Hooks run this through run-shell, which would show any output in the operator's pane.
exec >/dev/null 2>&1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WIDTH=42

# The pane command for an always-on view: a crash restarts it after a moment, a normal exit (q) closes the pane.
# Wrapped in sh because tmux runs pane commands through the operator's shell, which may not be POSIX (fish).
keep_running() {
  printf 'sh -c "while ! uv run -q --script \x27%s\x27; do sleep 2; done"' "$ROOT/sidebar/$1"
}

py() {
  uv run -q --no-project python "$ROOT/sidebar/$@"
}

# The live sidebar pane, or nothing. Pane ids are never reused within a tmux server.
sidebar() {
  local pane
  pane="$(tmux show-option -gqv @pi_sidebar_pane)"
  [ -n "$pane" ] && tmux display-message -p -t "$pane" '#{pane_id}'
}

dashboard_window() {
  tmux list-windows -a -F '#{window_id} #{@pi_dashboard}' | awk '$2 == "1" { print $1; exit }'
}

layout_of() {
  tmux display-message -p -t "$1" '#{window_layout}'
}

# The zoomed pane of a window, or nothing. Joining or removing a pane unzooms the window.
zoomed_pane() {
  tmux display-message -p -t "$1" '#{?window_zoomed_flag,#{pane_id},}'
}

# tmux shrinks a window's panes unevenly when the sidebar arrives and hands all the space back to the
# rightmost pane when it leaves, so splits drift on every visit. layout.py scales the window's own layout
# in proportion instead, which also keeps resizes made while the sidebar is there. An empty result means
# the layout could not be rewritten, and tmux's own reflow stands.
relayout() {
  local window="$1" layout
  shift
  layout="$(py layout.py "$@")"
  [ -n "$layout" ] && tmux select-layout -t "$window" "$layout"
}

# select-layout assigns panes to cells in pane-list order, so the sidebar must enter as the window's last pane.
last_pane() {
  tmux list-panes -t "$1" -F '#{pane_id}' | tail -n 1
}

open() {
  if ! command -v uv >/dev/null; then
    tmux display-message "Pi sidebar needs uv on the tmux server's PATH"
    return
  fi
  local before pane
  before="$(layout_of "$1")"
  pane="$(tmux split-window -h -f -d -l "$WIDTH" -t "$(last_pane "$1")" -P -F '#{pane_id}' \
    -e "PI_CODING_AGENT_DIR=$(tmux show-option -gqv @pi_agent_dir)" \
    "$(keep_running sidebar.py)")"
  if [ -z "$pane" ]; then
    tmux display-message "No room for the Pi sidebar in this window"
    return
  fi
  tmux set-option -g @pi_sidebar_pane "$pane"
  relayout "$1" add "$before" "${pane#%}" "$WIDTH"
}

follow() {
  local pane="$1" window="$2" source width before leaving zoomed_in zoomed_out
  source="$(tmux display-message -p -t "$pane" '#{window_id}')"
  [ "$source" = "$window" ] && return
  # Only a window someone is looking at: a detached session that a script creates must not take the sidebar.
  tmux list-clients -F '#{window_id}' | grep -qx "$window" || return
  # The dashboard already shows everything the sidebar would; the sidebar waits in the window you left.
  [ "$(tmux show-option -wqv -t "$window" @pi_dashboard)" = 1 ] && return
  width="$(tmux display-message -p -t "$pane" '#{pane_width}')"
  before="$(layout_of "$window")"
  leaving="$(layout_of "$source")"
  zoomed_in="$(zoomed_pane "$window")"
  zoomed_out="$(zoomed_pane "$source")"
  tmux join-pane -h -f -d -l "$width" -s "$pane" -t "$(last_pane "$window")" || return
  relayout "$window" add "$before" "${pane#%}" "$width"
  relayout "$source" remove "$leaving" "${pane#%}"
  [ -n "$zoomed_in" ] && tmux resize-pane -Z -t "$zoomed_in"
  [ -n "$zoomed_out" ] && tmux resize-pane -Z -t "$zoomed_out"
}

close() {
  local window layout
  window="$(tmux display-message -p -t "$1" '#{window_id}')"
  layout="$(layout_of "$window")"
  tmux kill-pane -t "$1"
  relayout "$window" remove "$layout" "${1#%}"
}

go_to() {
  tmux switch-client -c "$1" -t "$2"
  tmux select-window -t "$2"
  tmux select-pane -t "$2"
}

status() {
  case "$(tmux show-option -gqv status-right)" in
  *'#{@pi_agents}'*) ;;
  *) tmux set-option -ga status-right '#{@pi_agents}' ;;
  esac
  tmux list-clients -F '#{client_name}' | while read -r client; do tmux refresh-client -S -t "$client"; done
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
jump)
  target="$(tmux show-option -gqv @pi_jump_target)"
  if [ -n "$target" ]; then go_to "$2" "$target"; else tmux display-message -c "$2" "No Pi agent needs you"; fi
  ;;
dashboard)
  window="$(dashboard_window)"
  if [ -z "$window" ]; then
    # Created detached and marked before it is shown, so the sidebar's follow hook already sees the mark.
    window="$(tmux new-window -d -t "$4:" -n "π agents" -P -F '#{window_id}' \
      -e "PI_CODING_AGENT_DIR=$(tmux show-option -gqv @pi_agent_dir)" \
      "$(keep_running dashboard.py)")"
    tmux set-option -w -t "$window" @pi_dashboard 1
    tmux set-option -w -t "$window" automatic-rename off
    tmux switch-client -c "$2" -t "$window"
  elif [ "$window" = "$3" ]; then
    tmux last-window -t "$4"
  else
    tmux switch-client -c "$2" -t "$window"
  fi
  ;;
status)
  status
  ;;
esac
exit 0
