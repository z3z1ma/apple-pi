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
- Pi's built-in extensions (`tool_search`, MCP) live in `pi-coding-agent/dist/extensions/<name>/`, not `dist/core/`. Find one with `rg -l '"tool_search"' -g '*.js'` under `node_modules/@earendil-works/`. `tool_search` can load any registered tool whose `exposure` is `codemode` or `deferred`, extension tools included (`isSearchable` in `extensions/tool-search/tool.js`).

## Capturing the exact request

Pi does not store the system prompt or the tool definitions in the session JSONL. To see them, run `pi --mode rpc -e capture.ts` with a throwaway extension whose `before_provider_request` handler writes `event.payload` to disk and then throws: the request is never sent, so nothing is billed.

- Anthropic payloads carry `system[0]` (the Claude Code identity line pi-ai adds), `system[1]` (Pi's prompt) and `tools`. OpenAI payloads carry a developer `additional_tools` item and a developer string.
- Keep the run out of the operator's organization: point `PI_CODING_AGENT_DIR` at a temporary directory that symlinks every entry of `~/.pi/agent` except `state` and `sessions`.
- Start that directory's session-state runtime first (`spawnRuntime` from `components/session-state/src/client.ts`). Otherwise the prompt is built before the person is registered, and it gets the non-root `org` text with no `role-catalog` or `pi-exec-peers`; that race, not the provider, explained a first capture's diff. Afterwards kill the runtime by its pid file, and check again, because the bridge can respawn it while pi exits.
- A reusable script: `.ledger/202611032038-custom-system-prompt/current-prompt/capture.mjs` (it moves under `.ledger/history/` when that task closes).
