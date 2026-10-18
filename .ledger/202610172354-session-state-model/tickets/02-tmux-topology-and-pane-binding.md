# 02: tmux topology and pane binding

**What to build:** The runtime follows every live tmux server on the Mac once a second and keeps its servers, sessions, windows, and panes (including panes without Pi) in the database, keyed within their server by socket path. A session running in tmux has its incarnation bound to its pane, reported by its bridge at once.

**Blocked by:** 01 Runtime and bridge tracer

**Status:** ready-for-agent

- [ ] With a scratch tmux server holding two sessions and several panes, the database lists that server by socket path and all its sessions, windows, and panes, including panes that run no Pi.
- [ ] A faux Pi session started inside a scratch-server pane has its incarnation bound to that pane (server, `%pane`, tty) as soon as its bridge connects.
- [ ] Creating and killing windows and panes on the scratch server is reflected in the database within about a second, with events for each change.
- [ ] Stale socket files with no running server produce no server rows; two live servers with colliding pane ids stay distinct.
- [ ] A Pi session outside tmux appears with no pane binding.
