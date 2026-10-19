# 08: The interface

**What to build:** Old School RuneScape's layout, drawn in the fantasy theme's style. A minimap of the current place shows dots for agents, townsfolk, and the avatar, and clicking it walks there. Orbs count who needs the operator and who is working. The side panel has the Agents, Needs you, Work, Places, and Settings tabs; Mail and Slack join in their slices. From any tab the operator can talk to, examine, go to, or open the terminal of any character. The chatbox shows world events from the runtime, filterable by kind. Go to its terminal switches the operator's tmux client to the character's pane.

**Blocked by:** 02 Places follow reporting and repositories

**Status:** done

- [x] Needs you lists questions first and finished work next, matching the sidebar's attention for the same sessions.
- [x] Work groups agents by ledger task; Agents groups them by place.
- [x] Each tab action works on a character in another place without walking.
- [x] A runtime event (start, settle, question, stop) appears in the chatbox within a second, and the filters hide and show each kind.
- [x] Go to its terminal focuses the right tmux pane.
- [x] Meets the bar in the polish bar in the [spec](../spec.md#further-notes): judged on captured screenshots and a short recording, not on passing tests alone.
