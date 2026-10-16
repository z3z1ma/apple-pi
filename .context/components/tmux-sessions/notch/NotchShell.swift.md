## symbol:Shell.focus

A click on a worker runs the notify component's focus script as `<tmux session> "" <pane id>`, with `TMUX_SOCKET` set to the agent's tmux server.
Why: the panel runs outside tmux, with no `$TMUX` and no attached client, which is the context that script already handles for notification clicks. Without the socket it would switch the default server's client, even for an agent on another server.
Coupled: components/notify/scripts/focus-tmux.sh, components/tmux-sessions/scripts/notch.sh

## symbol:claimPanel

A build is identified by `CommandLine.arguments[0]`. That is the absolute cache path `notch.sh` launches, and its file name carries the source hash.
Why: if the same binary were launched by another path, it would look like another build and replace the running panel instead of exiting as a duplicate.

Known residual risk: two starts of different builds within about 100 ms of each other, both racing to replace the same older panel, can leave the older of the two builds running. The next root pi start then replaces it.
Why: builds have no order, only hashes, so a start cannot tell the newer build from the older one. Each start replaces only the panel it first saw, and steps aside when a rival takes over first. Without that rule, the two would kill each other in turn.
Coupled: components/tmux-sessions/scripts/notch.sh, components/tmux-sessions/src/index.ts
