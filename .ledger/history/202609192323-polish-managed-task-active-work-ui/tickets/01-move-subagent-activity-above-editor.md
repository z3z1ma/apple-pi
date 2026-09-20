# 01: Move subagent activity above the editor

**What to build:** Replace the current duplicated subagent presentation with one passive active-work projection above the prompt editor and a terse active-agent count in the editor metadata row. The prompt must remain the bottom-most surface, native editor navigation must remain available, and terminal outcomes must continue to appear through the existing transcript notifications rather than lingering in a second roster.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] While eligible top-level subagents are running or queued, the above-editor surface shows their identity, current activity, and useful live statistics, and every rendered line remains within the terminal width.
- [x] The input card shows `agents:N` for the current running-plus-queued public subagent count, hides it when the count is zero, and preserves context usage on narrow terminals before less important metadata.
- [x] No subagent roster, navigation hint, spacer, or other extension content renders below the prompt editor.
- [x] With the prompt editor focused, arrow and cursor keys retain native editor behavior instead of entering a hidden Fleet navigation mode.
- [x] When an agent completes, fails, or is stopped, it leaves the passive active-work surface and count while its existing transcript notification remains available.
- [x] Session switching, tree navigation, shutdown, non-TUI modes, and theme invalidation leave no stale widget, status, input handler, or timer behind.
