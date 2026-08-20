#!/usr/bin/env bash
# pi-tmux-sessions
#
# List, monitor status, and jump across nested Pi sessions from a single popup.
# tpm (or run-shell) executes this file on tmux startup; it reads user options
# (with sensible defaults) and installs the key bindings.
#
# Status is published by the Pi extension in components/tmux-sessions/src, which
# writes a JSON record per session that scripts/agents.sh reads. Load that
# extension in Pi for the picker to show anything.

CURRENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/helpers.sh
. "$CURRENT_DIR/scripts/helpers.sh"

launch_key="$(get_tmux_option @pi_launch_key 'y')"
list_key="$(get_tmux_option @pi_list_key 'u')"

# Launch (or re-attach to) a Pi session for the current pane's directory.
# #{pane_current_path} / #{window_id} are expanded by run-shell before the args
# reach the script.
tmux bind-key "$launch_key" \
  run-shell "$CURRENT_DIR/scripts/launch.sh '#{q:pane_current_path}' '#{q:window_id}'"

# Open the session picker. When pressed from inside a session popup, list.sh
# closes that popup first so the picker opens full-size on the outer client.
tmux bind-key "$list_key" \
  run-shell "$CURRENT_DIR/scripts/list.sh '#{q:client_name}'"

# Forward a bell from a dedicated session to its origin window's pane, so tmux's
# own bell machinery picks it up even though the session that rang is separate.
if [ "$(get_tmux_option @pi_forward_bell 'on')" = 'on' ]; then
  tmux set-hook -g alert-bell \
    "run-shell -b \"$CURRENT_DIR/scripts/bell.sh '#{q:hook_session_name}'\""
fi
