# 03: Choices are saved in pi state

**What to build:** Each session's vibe, room, shuffle look and dragged worker positions are kept in `$PI_HOME/state/notch.json` through the shell, not in WebKit localStorage. A later web app or Tauri app can then read the same choices. The shell injects the saved state when the page loads and writes each change atomically. See `plan.md`, Saved choices.

**Blocked by:** 01 (Notch panel runs from the component, started by hand)

**Status:** done

- [x] After changing a session's vibe and room, shuffling, and dragging a worker, a panel restart shows the same room, look and placement.
- [x] `notch.json` holds those choices for each session.
- [x] The page no longer reads or writes localStorage.
- [x] `docs/tmux-sessions.md` names `notch.json` and says what it holds.
