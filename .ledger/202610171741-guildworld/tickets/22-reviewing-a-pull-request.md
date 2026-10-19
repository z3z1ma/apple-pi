# 22: Reviewing a pull request

**What to build:** From the forge, the operator opens a pull request's diff in a review page and comments, approves, or requests changes as himself. Every outside write first shows exactly what goes where and asks for confirmation. It is then logged in the chatbox and in an append-only local record.

**Blocked by:** 21 The forge shows pull requests

**Status:** ready-for-agent

- [ ] The diff renders in the review page with file and line context.
- [ ] A comment, approval, or change request is sent through `gh` only after confirmation, and declining sends nothing (shown with a fake `gh`).
- [ ] Each sent write appears in the chatbox and as an appended line in the local record.
- [ ] Meets the bar in the polish bar in the [spec](../spec.md#further-notes): judged on captured screenshots and a short recording, not on passing tests alone.
