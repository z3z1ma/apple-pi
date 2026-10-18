# 13: Attention and tmux glue

**What to build:** The model stores when the operator last saw each session; a mark-seen command sets it, and the runtime marks a session seen when its pane is the one a tmux client shows. Needs you means an open prompt or a new reply since last seen. The runtime writes the status-line summary and a jump-target option into tmux when state changes; the tmux plugin's focus hook is removed and the jump key switches to the runtime's target.

**Blocked by:** 02 tmux topology and pane binding; 03 Rich activity; 04 Conversation index and read-through; 08 Command channel

**Status:** ready-for-agent

- [ ] With a client attached to a scratch-server pane holding a faux session, that session's seen time updates without any hook.
- [ ] A mark-seen command sets the seen time and clears needs you for a session with no open prompt.
- [ ] A session that settles with a new reply after its seen time, or opens a questionnaire, is needs you.
- [ ] The scratch server's status-line option holds the current summary after each relevant change, and its jump-target option names the pane that has needed the operator longest.
- [ ] The plugin installs no pane-focus seen hook, and the jump binding switches to the target pane.
