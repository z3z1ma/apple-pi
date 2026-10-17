#!/usr/bin/env bash
# Set up an isolated Orchard acceptance run (spec seam B) and start Orchard in a scratch tmux server.
# Usage: acceptance-setup.sh <new-scratch-dir>
# Teardown: tmux -L orchard-accept kill-server; rm -rf <scratch-dir>
set -euo pipefail
if tmux -L orchard-accept has-session 2>/dev/null; then echo "acceptance-setup: tmux -L orchard-accept is running; kill it first" >&2; exit 1; fi
S=$(mkdir "$1" && cd "$1" && pwd) # mkdir fails when the directory exists: every run starts fresh.
REAL_PI=$(command -v pi)
mkdir -p "$S/bin" "$S/orchard" "$S/repo" "$S/mailbox" "$S/tmux-state" "$S/sessions"

# Every Pi started in this tmux server, including workers Orchard starts, runs with MCP off (no server
# connects) and stores sessions under the scratch directory; the environment variable, unlike
# --session-dir, also reaches subagent sessions.
cat > "$S/bin/pi" <<PI
#!/usr/bin/env bash
export PI_CODING_AGENT_SESSION_DIR="$S/sessions"
exec "$REAL_PI" --no-mcp "\$@"
PI
printf '#!/bin/sh\necho "gh is disabled in this acceptance run" >&2\nexit 1\n' > "$S/bin/gh"
chmod +x "$S/bin/pi" "$S/bin/gh"

cat > "$S/orchard/AGENTS.md" <<CHARTER
# Orchard charter

Before your first reply in every session, read the orchard skill and follow it.

This is an acceptance test in a scratch area. Work only inside $S. Use no network services: no MCP tools, gh, curl, git push, Slack, Jira or email. Projects live under $S.

- Sweep cadence: every 3 minutes.
- Sweep sources: the ledger and the workers only.
CHARTER
git -C "$S/orchard" init -q && git -C "$S/orchard" add AGENTS.md && git -C "$S/orchard" -c user.name=t -c user.email=t@t commit -qm charter

printf 'export const add = (a, b) => a + b;\n' > "$S/repo/math.js"
git -C "$S/repo" init -q && git -C "$S/repo" add . && git -C "$S/repo" -c user.name=t -c user.email=t@t commit -qm init

# tmux gives each new pane the PATH of the client that created it, not the session environment, so the
# first pane gets the wrapper PATH explicitly and Orchard's own `tmux new-window` calls pass it on to workers.
# /bin/sh keeps a login shell such as fish from putting the real pi first again.
tmux -L orchard-accept -f /dev/null start-server \; set -g default-shell /bin/sh \; new-session -d -x 220 -y 60 -s accept -n orchard -c "$S/orchard" \
	-e PI_MAILBOX_DIR="$S/mailbox" -e PI_TMUX_STATE_DIR="$S/tmux-state" -e PI_TMUX_SESSION_BELL=off \
	"env PATH='$S/bin:$PATH' pi --session-id orchard"
echo "$S"
