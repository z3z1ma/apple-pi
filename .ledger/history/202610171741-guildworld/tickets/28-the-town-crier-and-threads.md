# 28: The town crier and threads

**What to build:** The town crier reaches any channel, read or unread. A thread reads in a panel; the operator replies as himself through the outside-write gate, or asks an agent to look into it. A private talk with an agent never posts to Slack.

**Blocked by:** 13 Instructing an agent from the panel; 22 Reviewing a pull request; 27 Slack sign-in and the town square

**Status:** done

- [x] The crier finds a channel with no unread messages and opens it.
- [x] A reply is posted to the fake Slack server only after confirmation and is logged like other outside writes.
- [x] Asking an agent sends an instruction naming the thread and posts nothing to Slack.
- [x] Meets the bar in the polish bar in the [spec](../spec.md#further-notes): judged on captured screenshots and a short recording, not on passing tests alone.
