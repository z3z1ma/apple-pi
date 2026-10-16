## symbol:Shell.focus

A click on a worker runs the notify component's focus script as `<tmux session> "" <pane id>`, with `TMUX_SOCKET` set to the agent's tmux server.
Why: the panel runs outside tmux, with no `$TMUX` and no attached client, which is the context that script already handles for notification clicks. Without the socket it would switch the default server's client, even for an agent on another server.
Coupled: components/notify/scripts/focus-tmux.sh, components/tmux-sessions/scripts/notch.sh
