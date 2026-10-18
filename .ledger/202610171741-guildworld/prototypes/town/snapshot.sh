#!/bin/sh
# PROTOTYPE: write live.json from the real feed (run inside tmux): live Pi sessions plus tmux session names.
cd "$(dirname "$0")"
root=$(cd ../../../.. && pwd)
agents=$(uv run -q --no-project python "$root/components/tmux-sessions/sidebar/agents.py" list)
sessions=$(tmux list-sessions -F '#{session_name}' | python3 -c 'import json,sys; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))')
printf '{"agents": %s, "tmuxSessions": %s}\n' "$agents" "$sessions" > live.json
echo "wrote live.json"
