#!/usr/bin/env bash
# PROTOTYPE: toggle the Pi agent sidebar as a full-height pane on the right of the current tmux window.
# Usage: run.sh [width]   (default 42 columns)
set -euo pipefail
dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
window="$(tmux display -p '#{window_id}')"

existing="$(tmux list-panes -t "$window" -F '#{pane_id} #{@pi_sidebar}' | awk '$2 == "1" { print $1; exit }')"
if [ -n "$existing" ]; then
  tmux kill-pane -t "$existing"
  exit 0
fi

pane="$(tmux split-window -h -f -l "${1:-42}" -d -t "$window" -P -F '#{pane_id}' "uv run --script '$dir/sidebar.py'")"
tmux set -p -t "$pane" @pi_sidebar 1
