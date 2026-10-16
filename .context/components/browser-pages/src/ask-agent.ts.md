## symbol:askFork

`liveSession(ctx)` finds a session only if `trackLiveSessions()` ran before that session's first prompt, because it patches `AgentSession.prototype.prompt` to record sessions. `browserPages()` calls it at install time, and `page.session.ask` is set from `liveSession(ctx)` so a page that cannot fork shows no ask mode.
Why: Pi gives extensions no handle on their `AgentSession`; calling `trackLiveSessions()` lazily, at the first question, would miss the session that is already running.

The fork's messages end with a placeholder result (`pending`) for any still-running tool call (`closePendingCalls`): the review call that waits for the verdict, or whatever the agent runs while a reader talks to the explanation's tutor.
Why: providers reject a conversation with an unanswered tool call. The faux model accepts it, so the test asserts the placeholder directly.

Coupled: components/browser-pages/src/index.ts, components/shared/src/forked-continuation.ts
Verify: components/browser-pages/tests/ask-agent.test.ts
