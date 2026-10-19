# 13: Instructing an agent from the panel

**What to build:** The panel's actions drive the agent. When idle: Reply. When busy: Redirect now, Tell it after this, and Stop, which asks for confirmation. Each action shows its receipt in the panel and the chatbox. The agent's reply streams into the panel as it is written.

**Blocked by:** 10 The conversation panel reads real transcripts; 12 Live reply streaming

**Status:** done

- [x] In the backend API test, each action becomes its session-state command (`talk`, `steer`, `follow_up`, `abort`) and reports its receipt.
- [x] Stop asks for confirmation when the agent is busy and sends nothing if declined.
- [x] A reply streams into the open panel and ends as the stored entry without a jump in the text.
- [x] Meets the bar in the polish bar in the [spec](../spec.md#further-notes): judged on captured screenshots and a short recording, not on passing tests alone.
