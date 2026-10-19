# 14: Answering questions in the world

**What to build:** When an agent asks a question, the panel shows it as a themed form. Each option has its description, multi-select works where the question allows it, and a free-text choice is always offered. Answering sends the `answer` command, and the question closes in the terminal too. Dialogs that only the terminal can answer say so and offer Go to its terminal.

**Blocked by:** 10 The conversation panel reads real transcripts

**Status:** done

- [x] A real `ask_user_question` from a faux session is answered from the form, the tool receives the same answers as from the terminal, and the terminal dialog closes.
- [x] When the terminal answers first, the form closes and says it was answered there.
- [x] A terminal-only dialog shows the go-to-terminal notice instead of a form.
- [x] Meets the bar in the polish bar in the [spec](../spec.md#further-notes): judged on captured screenshots and a short recording, not on passing tests alone.
