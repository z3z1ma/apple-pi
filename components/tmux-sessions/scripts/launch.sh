#!/usr/bin/env bash
# Launch (or re-attach to) a Pi session for a directory, shown in a popup.
# Args: <dir> [origin-window-id]   (both expanded by run-shell in the binding)
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=helpers.sh
. "$DIR/helpers.sh"

path="${1:-$PWD}"
window="${2:-}"

prefix="$(get_tmux_option @pi_session_prefix 'pi-')"
cmd="$(get_tmux_option @pi_command 'pi')"
args="$(get_tmux_option @pi_args '')"
[ -n "$args" ] && cmd="$cmd $args"
w="$(get_tmux_option @pi_popup_width '90%')"
h="$(get_tmux_option @pi_popup_height '90%')"

session="${prefix}$(session_hash "$path")"

if [[ "$(tmux display-message -p '#S')" == "$prefix"* ]]; then
  tmux display-message '🫪 Popup window already open'
  exit 0
fi

if ! tmux has-session -t "$session" 2>/dev/null; then
  [ -d "$path" ] || {
    tmux display-message "pi-tmux-sessions: $path no longer exists"
    exit 0
  }
  tmux new-session -d -s "$session" -c "$path" "$cmd"
fi

# Record which window launched it, so the picker can jump back here later.
[ -n "$window" ] && tmux set-option -t "$session" @pi_origin "$window"

tmux display-popup -w "$w" -h "$h" -E "tmux attach-session -t '$session'"
