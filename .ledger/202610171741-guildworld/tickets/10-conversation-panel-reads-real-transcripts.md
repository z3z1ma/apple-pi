# 10: The conversation panel reads real transcripts

**What to build:** Talking to a character opens the conversation panel over the dimmed world. One side has the large portrait, name, repository, ledger task, and current activity. The other has the full transcript in Markdown with code, with tool calls folded into one line that opens on click and earlier history loading on scroll. Opening it marks the character seen. Go to its terminal is always there. Examining a character uses the small dialogue box. The panel looks like a book in the fantasy theme.

**Blocked by:** 05 Characters and portraits; 08 The interface; 09 Batched history reads in the runtime

**Status:** done

- [x] A real session's transcript renders with its code blocks and folded tool calls, and a long session loads older pages on scroll without freezing the world.
- [x] Opening a character that needs you marks it seen in every view (sidebar, dashboard, orbs).
- [x] The panel shows a character's ledger task and current activity from the runtime.
- [x] Meets the bar in the polish bar in the [spec](../spec.md#further-notes): judged on captured screenshots and a short recording, not on passing tests alone.
