# Pi 0.84.4 opportunities for Apple Pi

Research date: 2026-08-31

## Executive judgment

Pi 0.84.4 is worth adopting. It handles normal post-tool pre-response compaction natively, but Apple Pi must retain a narrow fallback when one tool result is at least Pi's `keepRecentTokens` budget: 0.84.4 detects the threshold there but cannot prepare compaction or emit a failure event. Native failures that do emit `session_compact_failed` can be made fail-closed through the public abort API.

Recommended and implemented sequence:

1. Align the four directly pinned Pi development packages on 0.84.4.
2. Use native compaction for the normal path, gate automatic failures after `session_compact_failed`, and retain only a hidden cut-point marker for the over-budget gap.
3. Use `ui_prompt_start` / `ui_prompt_end` to make tmux `waiting` status cover every blocking extension UI prompt.
4. Keep the notebook compaction trigger, notebook packet restoration, xAI server-side compaction, xAI hosted-tool injection, subagent queues, and usage accounting.
5. Verify rather than assume whether internal summarization traverses `before_provider_request`; 0.84.4 uses the raw stream and bypasses Apple Pi's xAI hosted-tool hook.
6. Take the remaining changelog items as upstream fixes or operator settings; avoid new Apple Pi code for them.

## Primary sources

- [Pi 0.84.4 release notes](https://pi.dev/news/releases/0.84.4)
- [Pi 0.84.3 release notes](https://pi.dev/news/releases/0.84.3)
- [Pi news index](https://pi.dev/news)
- [0.84.4 GitHub release](https://github.com/earendil-works/pi/releases/tag/v0.84.4)
- [Extension events](https://pi.dev/docs/latest/extensions#ui_prompt_start--ui_prompt_end)
- [Compaction](https://pi.dev/docs/latest/compaction)
- [RPC `clear_queue`](https://pi.dev/docs/latest/rpc#clear_queue)
- [Terminal capability overrides](https://pi.dev/docs/latest/terminal-setup#capability-overrides)

The official 0.84.3 and 0.84.4 npm artifacts were also compared against the installed 0.84.2 package. The important implementation points are in `dist/core/agent-session.js`, `dist/core/extensions/runner.js`, and `dist/core/extensions/types.d.ts`.

## Priority decisions

### P0 — Upgrade the Pi package family together

At the start of the assessment, Apple Pi pinned these development dependencies to 0.84.2 in `package.json` and `package-lock.json`:

- `@earendil-works/pi-agent-core`
- `@earendil-works/pi-ai`
- `@earendil-works/pi-coding-agent`
- `@earendil-works/pi-tui`

All four were moved to 0.84.4 in one change. The only listed 0.84.3 breaking change is the inherited rename from `GoogleThinkingLevel` to `GoogleApiThinkingLevel`; Apple Pi does not import those names.

Keep Pi's bundled packages as `peerDependencies: "*"`, as Pi's package contract requires. Document Pi 0.84.4 as Apple Pi's minimum supported host instead of encoding a peer range; operators update the installed host with `pi update` or `pi update self`.

### P0 — Make native compaction primary and retain one fallback

Pi 0.84.4 adds a native pre-next-response compaction check. After tool results enter the context, Pi estimates the next request, runs threshold compaction when preparation is possible, rebuilds the context, and resumes the same agent run.

Two edge paths need Apple Pi policy:

- When native compaction fails or is cancelled after it starts, `_compactBeforeNextAssistantResponse()` otherwise continues with unchanged messages. A public `session_compact_failed` handler can abort the active Agent signal and mark that session manager for the pre-dispatch compatibility gate.
- When one tool-result batch reaches `keepRecentTokens`, `findCutPoint()` can leave the first cut point and `prepareCompaction()` returns `undefined`. No compaction or failure event occurs. Apple Pi can append an empty hidden custom message after the result; that durable valid cut point lets native threshold compaction proceed without replacing the selected provider or persisting a synthetic assistant.

Keep `components/notebook/src/hooks/overflow-guard.ts`, but treat it as an exceptional fallback rather than the normal compaction owner. Its hidden marker gives Pi a valid cut point for the oversized-result case; native compaction remains the only compaction attempt.

Acceptance coverage should prove four paths independently:

1. native threshold compaction succeeds before the same-run continuation;
2. native failure aborts before a provider request is sent;
3. native cancellation aborts before a provider request is sent;
4. a tool-result batch at or above `keepRecentTokens` receives a hidden cut point and completes through native threshold compaction.

Preserve these separate responsibilities:

- `components/notebook/src/hooks/compaction-trigger.ts` — settled-time notebook/source-token policy;
- `components/notebook/src/hooks/context-packet.ts` — deterministic notebook restoration after any persisted compaction;
- `components/xai-context-compaction/` — xAI `/responses/compact`, opaque-item persistence/replay, and bounded text fallback.

Pair passive mode suppresses notebook maintenance and exceptional hidden cut-point insertion, not Pi's native compaction or automatic-failure safety. Users who want to disable host auto-compaction use Pi's native `compaction.enabled` setting.

### P1 — Generalize tmux waiting status with UI prompt events

Pi 0.84.4 emits nested-safe, best-effort events around blocking `ctx.ui.select`, `confirm`, `input`, `editor`, and `custom` calls.

Replace the `ask_user_question` tool-name special case in `components/tmux-sessions/src/index.ts` with:

- `ui_prompt_start` → `waiting`
- `ui_prompt_end` → `ctx.isIdle() ? "idle" : "busy"`

Apple Pi's questionnaire uses `ctx.ui.custom()` in TUI mode, so it remains covered. The broader events also handle future extension confirmations and selectors. The existing serialized state-write queue should preserve rapid start/end order.

Keep the Ask-specific path in `components/notify/src/index.ts`. It uses the tool arguments to produce a useful question summary; a generic `custom` UI event has no equivalent detail and would also notify for ordinary dialogs.

### Keep — xAI extensions

Pi 0.84.3 moves built-in xAI models to the Responses API with encrypted reasoning replay, and 0.84.4 makes Grok 4.6 the default. This makes Apple Pi's existing xAI gates the default path rather than making them obsolete.

Keep:

- `components/xai-context-compaction/` — Pi still has no equivalent xAI `/responses/compact` lifecycle with Apple Pi's opaque-item replay and text fallback;
- `components/xai-hosted-tools/` — Pi's ordinary Responses support does not inject Apple Pi's `web_search` and `x_search` tools.

Re-run their payload/replay tests after the upgrade because a larger share of normal xAI sessions will now exercise them.

A 0.84.4 integration check confirms the important boundary: ordinary Agent calls supply the `onPayload` callback that drives `before_provider_request`, while internal compaction and branch-summary calls invoke the raw `agent.streamFunction` without it. Apple Pi's xAI hosted-tool hook therefore does not run for summarization and needs no summarization-specific guard.

## Direct upstream benefits that need no Apple Pi code

### Pair-programmer history ordering

Apple Pi intentionally sends late pair advice with `triggerTurn: false` after an operator abort so it records the advice without restarting the agent. In 0.84.2, such a message could be inserted between a tool call and its result while the agent was still running, producing provider-invalid replay history.

Pi 0.84.4 defers the custom message until `turn_end`, after tool results are present. Apple Pi should keep its `autoResumeSuppressed` policy unchanged and gain the ordering fix from the dependency upgrade.

### Compaction correctness

The upgrade also supplies these relevant fixes without an extension change:

- oversized post-tool continuations are checked for compaction before the next provider request on the normal success path;
- threshold compaction still runs when a provider omits streaming usage;
- Pi core compaction and branch summarization requests omit active agent tools and use the raw provider stream, bypassing Apple Pi's `before_provider_request` hosted-tool hook;
- output-limit-truncated summaries are rejected instead of persisted;
- compaction and branch-summary usage is persisted and can be shown in transcript notices.

`components/status-footer/src/usage.ts` already counts `compaction` and `branch_summary` entry usage, so accounting should continue without special handling.

### Session durability

0.84.4 repairs append behavior when a resumed Pi JSONL session lacks a trailing newline. This protects root and persisted child sessions, including Apple Pi notebook entries. Apple Pi's independent sidecar NDJSON writers already append their own newlines and need no change.

### Extension/runtime robustness

0.84.3 also fixes failed extension factories leaving registrations behind, bundled CLI extension loading, nested skill discovery, invalid settings visibility, deterministic resource glob expansion, and startup loading costs. These improve Apple Pi as a large extension package but do not justify local wrappers.

## Additional API decisions

### Adopt `session_compact_failed`

Available since 0.84.3 with `reason`, `errorMessage`, `aborted`, `willRetry`, and `fromExtension`. Apple Pi has two concrete reasons to consume it after the upgrade:

- preserve a fail-closed overflow policy by aborting a continuation when pre-response native compaction fails, subject to an integration test proving that the provider call is stopped;
- update `components/notify/src/index.ts` so a compaction failure or cancellation that settles without a later assistant `message_end` cannot produce a stale or empty “Task complete” notification. A later successful assistant message should clear that provisional failure state normally.

The xAI hook's existing warning/fallback and the notebook's explicit `ctx.compact()` callbacks remain useful, but they do not cover these two consumers.

### RPC `clear_queue`

This clears Pi's steering and follow-up queues for external RPC clients. Apple Pi's subagent concurrency queue, pending child steers, pair advice, and reminder queue are separately owned. Apple Pi's Pi Exec workers use JSON print mode, not the RPC client. There is no current integration point.

### Public image MIME detection

`detectSupportedImageMimeTypeFromFile()` is now a supported export. Apple Pi has no duplicate file-sniffing implementation; its xAI converter receives already-materialized image data. Use the helper only if a future Apple Pi feature accepts local image paths.

### Operator-facing settings and models

These are useful directly in Pi but do not belong in Apple Pi code:

- terminal hyperlink/image/truecolor overrides;
- fullscreen copy-on-select behavior;
- `/thinking` and explicit Ctrl+S persistence;
- safer installer-managed updates;
- PowerShell support;
- DeepSeek V4 Flash Vision and catalog corrections.

In particular, do not auto-set terminal capability overrides from the tmux integration. They are environment-specific escape hatches for incorrect detection, not portable package policy.

## Upgrade proof performed

A temporary copy of the current working tree was changed only to pin the four Pi development packages to 0.84.4. The repository itself was not changed by this proof.

Passed in the temporary copy:

- `npm run typecheck`
- `npm run test:unit` — 84 files, 898 tests
- `npm run test:pair` — 112/112 offline pair tests
- `npm run test:loader`
- `npm run pack:check`

This proves the current TypeScript and package surface are compatible with 0.84.4 before the implementation change. It does not prove the compaction safety/fallback or tmux event migration; those need their own implementation tests.

## Proposed acceptance criteria

1. All four direct Pi development dependencies and the lockfile resolve to 0.84.4.
2. Native pre-response compaction success is proven before the second provider request.
3. Native compaction failure and cancellation stop the continuation before the next provider request.
4. A trailing tool-result batch at or above `keepRecentTokens` receives a hidden durable cut point, remains absent from provider context after reload, and completes through native threshold compaction.
5. Root, child, BTW, and Pi Exec worker flows load the same compaction success/failure policy.
6. The notebook source-token trigger, notebook packet restoration, and xAI compaction behavior remain covered.
7. An integration test proves that ordinary xAI agent requests traverse `before_provider_request`, while internal compaction summarization bypasses that hook and receives no hosted-tool injection.
8. A pair-programmer integration test exercises the actual advisory/reminder `sendCustomMessage({ deliverAs: "steer", triggerTurn: false })` path during a tool-using turn and proves the custom entry is persisted after every tool result.
9. A failed or cancelled compaction cannot result in a stale successful macOS completion notification when no later assistant message replaces the failure state.
10. Tmux status reports `waiting` for any blocking extension UI prompt and restores `busy` or `idle` correctly.
11. Typecheck, unit, pair, loader, and package checks pass on the upgraded tree.
