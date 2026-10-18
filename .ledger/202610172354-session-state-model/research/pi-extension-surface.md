# What a Pi extension can observe and control

Research for [What a Pi extension can observe and control](../decisions/01-what-a-pi-extension-can-observe-and-control.md). Read-only scout of installed Pi 1.3.0 (`~/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/`, declarations in `dist/core/extensions/types.d.ts`, cited as `types.d.ts`) and apple-pi, 2026-10-18.

## Events (`pi.on`)

- **Session:** `session_start` (`reason`: startup, reload, new, resume, fork; `previousSessionFile`), `session_info_changed` (name), `session_before_switch`, `session_before_fork` (`entryId`, `position`), `session_shutdown` (`reason`: quit, reload, new, resume, fork; `targetSessionFile`), `session_before_tree` / `session_tree` (`newLeafId`, `oldLeafId`) (`types.d.ts:573-671`).
- **Compaction and context:** `session_before_compact`, `session_compact`, `session_compact_failed` (with `reason`, `willRetry`), `context`, `context_with_system` (`types.d.ts:601-692`).
- **Provider:** `before_provider_request`, `before_provider_headers`, `after_provider_response` (status, headers), `provider_stream_event` (parsed, not persisted) (`types.d.ts:693-719`; `docs/extensions.md:104-112`).
- **Agent, turn, message:** `before_agent_start` (user prompt or custom message), `agent_start`, `agent_end` (messages), `agent_before_settle` (`outcome`: completed, aborted, error; pending messages), `agent_settled` (`aborted`), `turn_start`/`turn_end` (index, message, tool results, entry ids), `message_start`, `message_update` (cumulative in-process message plus the stream event), `message_end` (`types.d.ts:720-852`).
- **Tools:** `tool_call` (id, optional `parentToolCallId`, name, mutable input; can block), `tool_execution_start` / `_update` (`partialResult`) / `_end` (`result`, `isError`, `durationMs`), `tool_result` (`types.d.ts:853-884, 930-1039`). Nested calls (for example inside `pi_exec`) emit these events with `parentToolCallId` (`docs/extensions.md:149-150`).
- **Input and settings:** `input` (`source`: interactive, rpc, extension; `streamingBehavior`), `user_bash`, `model_select`, `thinking_level_select` (`types.d.ts:885-929`).
- **UI prompts:** `ui_prompt_start` / `ui_prompt_end` carry only `kind` and optional `title`, never the prompt's content (`types.d.ts:807-820`). The questions of `ask_user_question` are visible as that tool's call arguments (`tool_call`, `tool_execution_start`).
- **Not extension events:** retries (`auto_retry_start`/`_end`) and `extension_error` exist only on the JSON/RPC stream (`docs/json.md:164-194`).

## Reading and acting

- `ExtensionContext`: `cwd`, `mode` (tui, rpc, json, print), `hasUI`, `model`, `thinkingLevel`, read-only `sessionManager` (session id, file, header incl. `parentSession`, entries, branch, tree, leaf, name), `isIdle()`, `hasPendingMessages()`, `getContextUsage()` (tokens, window, percent), `signal`, `abort()`, `compact()`, `shutdown()` (`types.d.ts:213-252`; `dist/core/session-manager.d.ts:178-334`).
- `pi.sendUserMessage(content, { deliverAs: "steer" | "followUp" })` always triggers a turn; `pi.sendMessage(custom, { triggerTurn, deliverAs: "steer" | "followUp" | "nextTurn" })`; `pi.appendEntry(type, data)`; `pi.events` bus; session name, labels, model and thinking level, active tools (`types.d.ts:1223-1399`).
- Command contexts add `waitForIdle`, `newSession`, `fork`, `navigateTree`, `switchSession`, `reload` (`types.d.ts:282-323`).
- **Open prompts:** a dialog can be dismissed through the `AbortSignal` its caller passed; there is no API to inject an answer into another extension's open dialog (`types.d.ts:39-195`). apple-pi's `ask_user_question` passes its tool signal to the dialog (`components/ask-user-question/src/index.ts:78-107`), so answering it from outside needs a change in that tool.
- **Identity in process:** `process.pid`, `TMUX`/`TMUX_PANE` environment, registered flags through `pi.getFlag` (apple-pi registers `--reports-to`) (`components/tmux-sessions/src/index.ts:79-200`).

## Lineage in apple-pi

- **Subagents:** child `AgentSession`s are created in the parent process; persistent children record `parentSession` = the parent's session file; the manager keeps in-memory `AgentRecord`s (random id, status, `parentAgentId`, `sessionFile`) (`components/subagents/src/agent-runner.ts:591-705`; `agent-manager.ts:270-508`). Child `pi.on` events are not forwarded to the parent's extensions (not verified otherwise).
- **`pi_exec` workers:** spawned `pi` processes with `--no-session`; their activity reaches the program, not the parent's event bus (`components/pi-exec/src/agent-workers.ts`).
- **Forked continuations** (reflection, clarify): in-memory `Agent`s seeded from the parent, using the parent's session id; results return as custom messages; fork messages stay in the fork (`components/shared/src/forked-continuation.ts:210-357`).
- **Mailbox:** delivered mail becomes `custom_message` entries; the mailbox files and watcher are not Pi events (`components/tasks/src/mailbox.ts:76-157`).

## Only visible inside the session

Live streaming text (`message_update` with the cumulative message), provider stream events, `isIdle`/pending-message state, the abort signal, context usage, nested tool lifecycle, and subagent records. JSONL holds only completed entries; the tmux record holds selected identity and status.

## Gaps

No `pi.on` retry or error event; no API to answer another extension's open dialog; no forwarding of child or worker events to the parent; exact error and retry event sequences not traced.
