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
#   2. the foreground (most-recently-active) tmux client is currently displaying
#      the window that contains the target pane. This correctly handles multiple
#      Ghostty tabs/windows attached as separate clients to different sessions.
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

# 2. The foreground tmux client must be displaying the target pane's window.
#    Each Ghostty tab/window is a separate tmux client that may be attached to a
#    different session, so a per-session "window active / session attached" check
#    would falsely match a background tab attached to the Pi session. Instead
#    identify the foreground client as the most-recently-active attached client
#    and compare the window it is currently showing. This is a heuristic
#    (tmux cannot report which Ghostty tab is frontmost), but it errs toward the
#    client the operator last interacted with.
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

# The tmux window that contains the Pi pane.
pi_window="$(tm display-message -p -t "$target" '#{window_id}' 2>/dev/null || true)"
[[ -n "$pi_window" ]] || exit 1

# Foreground client = the attached client with the most recent activity.
# client_activity is an integer timestamp and client_name is a tty path with no
# spaces, so whitespace-delimited parsing is safe.
clients="$(tm list-clients -F '#{client_activity} #{client_name}' 2>/dev/null || true)"
[[ -n "$clients" ]] || exit 1
fg_client="$(printf '%s\n' "$clients" | sort -k1,1nr | head -1 | awk '{print $2}')"
[[ -n "$fg_client" ]] || exit 1

# The window that foreground client is currently displaying.
shown_window="$(tm display-message -p -c "$fg_client" '#{window_id}' 2>/dev/null || true)"
[[ -n "$shown_window" && "$shown_window" == "$pi_window" ]] || exit 1
exit 0
