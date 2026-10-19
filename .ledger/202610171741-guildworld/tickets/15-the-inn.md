# 15: The inn

**What to build:** Dormant agents sleep at the inn, painted to the art bible. The innkeeper lists each dormant agent with its last task, shows its last conversation, and wakes it into a new tmux window with the `start` command; the woken character walks out to its place. Ending a session (confirmed when busy) sends its character to the inn.

**Blocked by:** 03 Art bible and art pipeline; 07 Character life; 10 The conversation panel reads real transcripts

**Status:** done

- [x] A stopped session appears asleep at the inn and in the innkeeper's list with its last task.
- [x] Waking it starts a new incarnation in a new tmux window, and the same character walks to its place.
- [x] Ending a busy session asks for confirmation; ending an idle one does not.
- [x] The inn's walk grid, spots, and doors pass the place checks from 04.
- [x] Meets the bar in the polish bar in the [spec](../spec.md#further-notes): judged on captured screenshots and a short recording, not on passing tests alone.
