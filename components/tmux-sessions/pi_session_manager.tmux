#!/usr/bin/env bash
# Pi agent sidebar for tmux. The Pi extension runs this file once per tmux server, so tmux.conf needs no line;
# `run-shell <path>/pi_session_manager.tmux` in tmux.conf also works. Loading it twice is harmless.

SIDEBAR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/scripts/sidebar.sh"
key="$(tmux show-option -gqv @pi_sidebar_key)"

tmux bind-key "${key:-u}" run-shell "'$SIDEBAR' toggle '#{window_id}'"

# A fixed hook index replaces this plugin's hook on reload instead of appending a duplicate,
# and leaves the operator's own hooks on the same events alone.
tmux set-hook -g 'session-window-changed[71]' "run-shell -b \"'$SIDEBAR' follow '#{window_id}'\""
tmux set-hook -g 'client-session-changed[71]' "run-shell -b \"'$SIDEBAR' follow '#{window_id}'\""

# pane-focus-in fires only with focus-events on.
tmux set-option -g focus-events on
tmux set-hook -g 'pane-focus-in[71]' "run-shell -b \"'$SIDEBAR' seen '#{pane_id}'\""

# Completions from before tracking started count as seen, so the first sidebar does not open on a flood.
now="$(date +%s)"
tmux list-panes -a -F '#{pane_id} #{@pi_seen_at}' | while read -r pane seen; do
  [ -n "$seen" ] || tmux set-option -p -t "$pane" @pi_seen_at "$now"
done
