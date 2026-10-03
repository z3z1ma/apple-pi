# Pi request internals

How Pi 0.99 and 1.0 build a provider request, and what an extension must copy to continue a conversation with an identical request. Source: reading `@earendil-works/pi-coding-agent` (`core/sdk.js`, `core/agent-session.js`) and `@earendil-works/pi-agent-core` (`agent.js`, `agent-loop.js`) while building forked continuations. The contract that users see is in `docs/forked-continuations.md`; this page records the internals behind it.

## Request shape

- The provider context holds only `messages`. The system prompt and the declared tools travel in a leading message with role `system`, whose `toolsAdded` lists each tool's name, description, and schema. Later loadout changes are new `system` messages in the transcript.
- `AgentSession` installs a `prepareRequest` hook that replaces the loop's messages with `sessionManager.buildSessionProjection().messages`. The projection, not `agent.state.messages`, is what the provider sees.
- The loop then runs `transformContext` (extension `context` hooks and Pi's own projections) and `convertToLlm` before calling `streamFunction`.
- `agent.sessionId` becomes the provider session option. OpenAI-family providers send it as `prompt_cache_key`, so a request with a different session ID can miss the cache even when its prefix matches.

## Continuing an identical conversation

Build a new `Agent` from the live session's public `agent` fields: state (system prompt, model, thinking level, tools), `convertToLlm`, `transformContext`, `streamFunction`, `getApiKey`, `onPayload`, `onResponse`, `onProviderStreamEvent`, the tool hooks, `sessionId`, `thinkingBudgets`, `transport`, `maxRetryDelayMs`, and `toolExecution`. Seed it with the projection messages and append the new prompt.

Leave out `prepareRequest`, `finishTurn`, and `prepareNextTurnWithContext`. They are bound to the session: they rebuild the request from the session's own transcript, which would drop the appended prompt, and they append entries to that transcript.

Checked on Pi 1.0 with OpenAI: the fork's first request read the parent's whole cached prefix (11,136 cached tokens, 281 uncached).

## Pitfalls

- Extensions get no handle on their `AgentSession`. Pi's extension loader aliases `@earendil-works/pi-coding-agent` and `@earendil-works/pi-agent-core` to the host's own copies, so a patch on `AgentSession.prototype` reaches the running session.
- The copied callbacks still belong to the parent. Tools and hooks act on the parent's session, UI, and services.
- `streamFunction` starts Pi's cache warmer for any request carrying the session's ID. A fork request therefore replaces the parent's pending warming run.
- Print mode has no UI, so `ask_user_question` is deactivated there. A headless `pi --print` subprocess therefore declares different tools from an interactive session and does not reproduce its request.
