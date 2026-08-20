#!/usr/bin/env bash
# Open the session picker in a popup.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=helpers.sh
. "$DIR/helpers.sh"

prefix="$(get_tmux_option @pi_session_prefix 'pi-')"
w="$(get_tmux_option @pi_popup_width '90%')"
h="$(get_tmux_option @pi_popup_height '90%')"

# The client that pressed the key, and the session it is currently attached to.
# Matched by exact client_name so a stray popup on another client cannot be
# grabbed and detached instead of the one this invocation cares about.
me="${1:-}"
my_session="$(tmux list-clients -F '#{client_name} #{session_name}' 2>/dev/null |
  awk -v me="$me" '$1 == me { print $2; exit }')"

# open_picker <host>  — show the picker popup on <host>, or on the default client
# when <host> is empty. Returns display-popup's own exit status.
open_picker() {
  if [ -n "$1" ]; then
    tmux display-popup -c "$1" -w "$w" -h "$h" -E "$DIR/picker.sh"
  else
    tmux display-popup -w "$w" -h "$h" -E "$DIR/picker.sh"
  fi
}

case "$my_session" in
"$prefix"*)
  # Inside a session popup: close it, then reopen the picker on the outer client.
  #
  # display-popup returns before tmux finishes destroying the closing overlay,
  # and a popup opened during that window never receives keyboard input. So wait
  # for the popup's client to leave, settle past the teardown, then reopen —
  # retrying a reopen rejected mid-teardown (it returns almost instantly,
  # whereas a popup that opened blocks while in use).
  tmux detach-client -s "$my_session"
  for _ in $(seq 1 100); do
    tmux list-clients -F '#{session_name}' 2>/dev/null | grep -qx "$my_session" || break
    sleep 0.05
  done
  host="$(tmux show-options -gqv @pi_parent 2>/dev/null)"
  # A stale parent would make every retry fail; fall back to the default client.
  if [ -n "$host" ] && ! tmux list-clients -F '#{client_name}' 2>/dev/null | grep -qx "$host"; then
    host=''
  fi

  sleep 0.1
  rc=0
  for _ in $(seq 1 40); do
    before=$SECONDS
    open_picker "$host"
    rc=$?
    { [ "$rc" -eq 0 ] || [ $((SECONDS - before)) -ge 1 ]; } && break
    sleep 0.1
  done
  exit "$rc"
  ;;
*)
  # Normal case: this client is already the host, with no overlay to race.
  host="$me"
  tmux set-option -g @pi_parent "$host"
  ;;
esac

open_picker "$host"
