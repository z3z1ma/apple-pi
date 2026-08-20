#!/usr/bin/env bash
set -euo pipefail

# Decide whether the operator is already looking at the Pi pane, so the caller
# can suppress a redundant desktop notification. Exit 0 means "in focus, skip
# the notification"; any non-zero exit means "not confirmed in focus, deliver
# it". Every uncertain branch fails open (non-zero) so a real notification is
# never dropped because detection was inconclusive.
#
# "In focus" requires BOTH:
#   1. Ghostty is the frontmost macOS application, and
#   2. the target pane's tmux window is the active window of an attached
#      session (session + window level, matching the notification target).
#
# Runs from the Pi process (unlike focus-tmux.sh, which runs in a clicked
# launchd context), but still honors TMUX_BIN / TMUX_SOCKET so it targets the
# same server the extension resolved.

GHOSTTY_BUNDLE_ID="com.mitchellh.ghostty"

tmux_bin="${TMUX_BIN:-}"
tmux_socket="${TMUX_SOCKET:-}"

pane_id="${1:-}"
window_id="${2:-}"

# 1. Ghostty must be the frontmost application. lsappinfo needs no accessibility
#    permission, unlike System Events frontmost queries.
front_asn="$(/usr/bin/lsappinfo front 2>/dev/null || true)"
[[ -n "$front_asn" ]] || exit 1
front_bundle="$(/usr/bin/lsappinfo info -only bundleid "$front_asn" 2>/dev/null || true)"
# Output form: "LSBundleID"="com.mitchellh.ghostty"
case "$front_bundle" in
*\"${GHOSTTY_BUNDLE_ID}\"*) ;;
*) exit 1 ;;
esac

# 2. The target pane's window must be the active window of an attached session.
if [[ -z "$tmux_bin" || ! -x "$tmux_bin" ]]; then
	tmux_bin="$(command -v tmux || true)"
fi
[[ -n "$tmux_bin" && -x "$tmux_bin" ]] || exit 1

tm() {
	if [[ -n "$tmux_socket" ]]; then
		"$tmux_bin" -S "$tmux_socket" "$@"
	else
		"$tmux_bin" "$@"
	fi
}

target="$pane_id"
[[ -n "$target" ]] || target="$window_id"
[[ -n "$target" ]] || exit 1

info="$(tm display-message -p -t "$target" '#{window_active} #{session_attached}' 2>/dev/null || true)"
window_active="${info%% *}"
session_attached="${info##* }"

[[ "$window_active" == "1" && -n "$session_attached" && "$session_attached" != "0" ]] || exit 1
exit 0
