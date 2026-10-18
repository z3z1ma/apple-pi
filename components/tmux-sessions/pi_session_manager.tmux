#!/usr/bin/env bash
# Pi agent sidebar, dashboard, and status summary for tmux. The Pi extension runs this file once per tmux server,
# so tmux.conf needs no line; `run-shell <path>/pi_session_manager.tmux` in tmux.conf also works. Loading it twice is
# harmless.

SIDEBAR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/scripts/sidebar.sh"
option() {
  local value
  value="$(tmux show-option -gqv "$1")"
  printf '%s' "${value:-$2}"
}

tmux bind-key "$(option @pi_sidebar_key u)" run-shell "'$SIDEBAR' toggle '#{window_id}'"
tmux bind-key "$(option @pi_jump_key y)" run-shell "'$SIDEBAR' jump '#{client_name}'"
tmux bind-key "$(option @pi_dashboard_key A)" \
  run-shell "'$SIDEBAR' dashboard '#{client_name}' '#{window_id}' '#{session_id}'"

# A fixed hook index replaces this plugin's hook on reload instead of appending a duplicate,
# and leaves the operator's own hooks on the same events alone.
tmux set-hook -g 'session-window-changed[71]' "run-shell -b \"'$SIDEBAR' follow '#{window_id}'\""
tmux set-hook -g 'client-session-changed[71]' "run-shell -b \"'$SIDEBAR' follow '#{window_id}'\""

# The session-state runtime marks a session seen when a client shows its pane, and writes the summary
# (@pi_agents) and the jump target (@pi_jump_target); this file only shows and uses them.
tmux set-hook -gu 'pane-focus-in[71]'

"$SIDEBAR" status
