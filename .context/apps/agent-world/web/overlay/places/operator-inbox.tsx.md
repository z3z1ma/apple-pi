## file

The World inbox remains mounted when its iframe is hidden so its selected thread and unsent replies survive tab switches. Check host visibility at the start of `read`, including the automatic reread after a reply receipt. A reply already submitted while visible may finish while hidden; its success remains valid, but it does not authorize a new hidden read. Returning to the inbox leaves Read latest available rather than inventing a background acknowledgment.
Why: reading an operator thread advances its cursor. Gating only the original click would miss the later reread after an asynchronous reply, and unmounting the inbox would lose its local drafts.

The mounted inbox reports whether any reply draft is nonempty to world-drafts after each committed draft update. Its ref identifies one stable owner across draft-object replacements; cleanup removes only that owner. This feeds the parent's one unload guard while retaining the existing local draft storage.
Why: clearing an inbox reply must not clear a conversation draft's protection, and hiding the retained iframe must not unregister still-unsent text.
Coupled: apps/agent-world/web/world-visibility.ts, apps/agent-world/web/world-drafts.ts, apps/agent-world/web/workplace-world.tsx, apps/agent-world/web/workplace.tsx, apps/agent-world/src/backend/mail.ts
Verify: apps/agent-world/tests/world-conversation.test.ts, apps/agent-world/tests/world-navigation.test.ts
