# 27: Slack sign-in and the town square

**What to build:** First the Slack credential approach is settled with the operator (deferred in the spec) and recorded. Then he signs in, and each Slack channel with unread messages stands in the town square as a townsperson. The square is kept calm by a bound designed with him. The unread orb and the Slack tab join the interface, and townsfolk looks come in all three themes.

**Blocked by:** 08 The interface; 20 Anime school pack

**Status:** ready-for-agent

- [ ] The credential decision is recorded in the task before any Slack code lands, and credentials live only in the backend's private file.
- [ ] In the backend API test against a fake Slack server, channels with unread messages become townsfolk, and the bound holds when there are many.
- [ ] The unread orb and the Slack tab match the fake server's unread counts.
- [ ] Meets the bar in the polish bar in the [spec](../spec.md#further-notes): judged on captured screenshots and a short recording, not on passing tests alone.
