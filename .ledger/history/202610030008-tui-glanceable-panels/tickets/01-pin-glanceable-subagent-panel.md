# 01: Pin a glanceable subagent panel from `/work`

**What to build:** Choosing an agent in `/work` pins a glanceable subagent panel at the top right instead of opening the modal agent viewer. The editor keeps keyboard input while the panel stays visible. The panel lists the session's agents, running and finished, with the selected agent's live output below. `Alt+G` moves focus into the panel; `Alt+G` or `Esc` returns it to the editor. With focus, the panel keeps the agent viewer's actions: Enter steers, `x` twice aborts, the configured keys scroll, and `q` unpins. The panel hides below 120 terminal columns and returns when the terminal widens. A modal closed above it leaves it mounted. Update `docs/subagents.md`. See `../spec.md` and `.wiki/pages/tui-interaction-model.md`.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] Choosing an agent in `/work` mounts one overlay that is non-capturing, anchored top right, 33% wide, and at most 70% high; no modal `ctx.ui.custom` agent viewer opens.
- [x] While the panel is pinned and unfocused, typed keys reach the editor, not the panel.
- [x] The rendered panel lists running and finished agents and shows new output from the selected agent's session as it arrives.
- [x] `Alt+G` focuses the panel; `Esc` or `Alt+G` returns focus to the editor with the draft unchanged.
- [x] In the focused panel, Enter then text sends a steer to the selected agent; `x` twice aborts it; `q` removes the panel.
- [x] The panel's `visible` callback is false at 119 columns and true at 120.
- [x] Closing a modal opened above the panel leaves the panel mounted.
- [x] With no agent running, the panel stays mounted and lists finished agents.
- [x] Manual check in a real fullscreen Pi through tmux: pin, type in the editor, `Alt+G`, steer, `Esc`, open and close `/work` above the panel, `q`.
