# 05: Characters and portraits

**What to build:** The fantasy theme has a set of agent looks and a few avatar looks. Each look is a 16-frame sheet: walking down, up, and left with spelled-out phases, sitting at work from behind with its own seat, standing, and asking. Each look also has four portraits: neutral, happy, thinking, and worried. A session keeps its look across restarts, and the operator picks the avatar look in Settings.

**Blocked by:** 01 Agent World opens over the real runtime; 03 Art bible and art pipeline

**Status:** ready-for-agent

- [ ] Every sheet passes the pipeline's frame-layout and baseline checks, and every frame stands 120 px tall.
- [ ] A session's character has the same look after its process restarts and after the app restarts.
- [ ] The avatar look chosen in Settings persists across app restarts.
- [ ] Walking shows a clear four-phase stride in every direction.
- [ ] Meets the bar in the polish bar in the [spec](../spec.md#further-notes): judged on captured screenshots and a short recording, not on passing tests alone.
