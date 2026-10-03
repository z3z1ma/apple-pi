# 02: Mouse use and unpinning from `/work`

**What to build:** In fullscreen mode, a left click focuses the pinned subagent panel and the mouse wheel scrolls it. The Agents tab in `/work` offers an unpin action while a panel is pinned, with a key consistent with that tab's configured keybindings. Update `docs/subagents.md`. See `../spec.md`.

**Blocked by:** 01 (Pin a glanceable subagent panel from `/work`).

**Status:** ready-for-agent

- [ ] A left press on the panel focuses it.
- [ ] A wheel event over the panel changes its scroll position.
- [ ] The unpin action in `/work`'s Agents tab removes the pinned panel without focusing it, and is not offered when no panel is pinned.
- [ ] Manual check in a real fullscreen Pi through tmux: click to focus, wheel to scroll, unpin from `/work`.
