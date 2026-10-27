# Pi 1.1–1.2 assessment for Apple Pi

Assessment date: 2026-10-13. This assessment helps Apple Pi maintainers decide what to adopt and what to verify when upgrading from the checkout's Pi 0.99.0 development baseline to Pi 1.2.0. It compares the upstream [1.1.0 and 1.2.0 changelog](https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/CHANGELOG.md) with tagged documentation/source and the Apple Pi code present on the assessment date. It recommends work; it does not certify compatibility or authorize configuration changes.

Pi is the host coding-agent runtime; Apple Pi is its extension package. [Pi Exec](../exec.md) (`pi_exec`) runs bounded, type-checked Python through Monty and bridges calls back to host tools. [MCP](../mcp.md) connects external tool servers. In this assessment, a **custom wake-up** is an extension message that starts a model run without a new user prompt, and a **nested call** is a tool invoking another tool. **Readiness** means the target is available; **permission enforcement** means the call passes the configured exposure rules and hooks. These are separate guarantees.

## Outcome

Implemented on 2026-10-13 (ledger task `202610131309-pi-1-2-upgrade`). Apple Pi now builds and tests against Pi 1.2.0 and requires it. Pi Exec calls tools through `ctx.tools`/`ctx.executeTool()`, so the registered-tool capture patch is gone. Two recommendations were dropped after implementation: constraint tags in generated Python declarations (no model-facing stub carries constraints, and `tools_describe` already returns full JSON Schema), and tool-row `durationMs` (the thinking card times model output, not tool execution). The sections below are the original assessment.

## Summary

Upgrade to 1.2 through a focused compatibility pass. The highest-value changes are correct setup and prompt-cache behavior for extension-triggered runs, MCP readiness metadata for composition tools, and upstream MCP cancellation/security fixes. Keep Monty/Pi Exec, the notebook, server compaction, and tmux disk records. These releases do not replace those responsibilities.

The checkout pins all four Pi development dependencies to 0.99.0 and declares peers >=0.99.0 (`package.json`, `package-lock.json`). Its existing compile/test baseline does not prove 1.2 compatibility. No dependencies, user configuration, or production code were changed during this assessment.

## 1. Extension-triggered runs: highest upgrade priority

Pi 1.2 fires `before_agent_start` for idle `sendMessage(..., { triggerTurn: true })` runs. Its event is a union: `messageType: "user"` supplies `prompt`/`images`; `messageType: "custom"` supplies `message`, without `prompt`. Pi also treats setup as busy, queues messages sent during setup into that run, and honors aborts requested while starting. The release fixes prompt sections disappearing after a custom run's first tool call.

Apple Pi depends directly on these paths:

- `components/tasks/src/index.ts`: task notifications, scheduled prompts, and monitor events trigger turns.
- `components/pair-programmer/src/extension.ts`: pair findings can trigger turns; its start hook resets turn state and installs protocol guidance.
- `components/notebook/src/hooks/learning-cycle.ts`: explicit reflection/distillation commands trigger custom-message turns.
- Ledger, wiki, RTK, team/profile guidance, and project learnings use named prompt sections in start hooks.

Keep general capability/policy sections enabled for both run types. Adding user-only guards to every handler would remove the very guidance background wake-ups need. Review user-specific capture separately.

A concrete migration point is `components/notify/src/index.ts:544–549`: it reads `event.prompt` without narrowing the event. That access is invalid against 1.2 types and lacks a prompt on custom starts. Preserve or deliberately select the notification's task label on custom runs, while resetting run outcome state for both kinds. Its settled handler can also use the new `event.aborted` rather than relying only on final assistant/compaction events to detect cancellation.

Proof criteria: a custom wake-up gets the required sections on both its first and second provider requests; pending next-turn messages arrive; a message during setup queues without a second run; abort during setup prevents work; passive fork results and notebook packets still start no turn. After the lifecycle tests, run the `program_rpc_smoke` tool defined by [`.pi/programs/rpc_smoke.py`](../../.pi/programs/rpc_smoke.py) against the upgraded installed Pi, then `npm run audit:cache` to inspect session-log prefix caching. The smoke tool calls the real default model; run it only as an authorized live validation step.

Sources: [events and concurrency](https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/docs/extensions.md#events-and-concurrency), [event types](https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/src/core/extensions/types.ts), [1.2 changelog](https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/CHANGELOG.md).

## 2. Pi Exec: adopt native integration without adding another runtime

### Readiness

`reachesTools(input)` returns `"all"` or input-derived words that may contain tool/namespace names. MCP's `tool_call` handler uses it to wait for connecting or reconnecting servers before the outer tool executes. This is useful for `pi_exec` and saved `program_*` tools, which can discover or invoke tools dynamically. A conservative `"all"` declaration is correct for arbitrary discovery/dynamic calls; selective reachability would need evidence that it remains complete.

The current registrations have no such metadata. Apple Pi's internal `tools_search` searches captured definitions, unlike native `tool_search`, whose top-level call already participates in MCP readiness. The metadata can reduce an empty-catalog race, but it does not refresh a running Monty program's type stubs or enforce tool permissions.

Upstream MCP auto-activation still looks specifically for reaching tools named `codemode` or `tool_search`. Adding metadata to `pi_exec` alone does not make it the automatic replacement for codemode exposure. Keep the documented native-codemode-disabled, deferred/direct MCP setup; renaming Pi Exec is unnecessary.

### Native nested calls

Apple Pi already documents a deferred migration to `ctx.tools`/`ctx.executeTool()`. Revisit it during the upgrade:

- `components/pi-exec/src/tool-capture.ts` patches `ExtensionRunner.getAllRegisteredTools` to retain definitions.
- `components/pi-exec/src/host-calls.ts` validates arguments and directly calls `definition.execute`.
- Native nested execution supplies exposure filtering, validation, permission/result hooks, cancellation, parent call IDs, nested events, and usage aggregation.

This is not a new 1.2 API; the new readiness metadata makes the supported integration story more complete. Keep Monty budgets, checkpoints, guest contracts, durable traces, and root/child tool exclusions. Check pair observation and usage accounting carefully when nested events start firing: avoid duplicate observations or double-counting usage. Keep schema discovery restricted to callable tools, not merely registered definitions.

### Results and declarations

`components/pi-exec/src/guest-functions.ts` currently projects captured results to `text`, `content`, `details`, and `usage`, omitting top-level `structuredContent` and `isError`. Some MCP data may remain inside details, but that is not a uniform result contract. Upstream's structured-result improvements are a reason to test and deliberately preserve machine-readable values and error state, including arrays, null, and primitives. Receiving text is not proof of success; native `ctx.executeTool()` returns error outcomes rather than rejecting for tool failures.

Borrow codemode's schema-constraint guidance for generated Python declarations: integer/range/length/pattern/default information should be visible where the model discovers signatures. Apple Pi has schema-derived Python types and runtime validation already; expose missing constraints rather than copying codemode's implementation or enabling a second composition runtime.

Proof criteria: discovery while MCP connects; reconnect/disable/hidden tools; allowed and blocked nested calls; cancellation; object/array/null/primitive structured values; error results with data; one usage total; preserved Pi Exec exclusions and budgets.

Sources: [tool contracts](https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/docs/extensions.md#tools), [tool exposure/readiness](https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/docs/extensions.md#tool-exposure), [MCP implementation](https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/src/extensions/mcp/index.ts), local `docs/exec.md` and `docs/mcp.md`.

## 3. UI compatibility and supported data

`durationMs` provides recorded execution time after reload, and `outputPad` is available to renderers. Use these contracts for tool timing/padding rather than reconstructing execution time from transcript/render wall time. Pi Exec's own per-operation timings remain useful and are a different responsibility.

`components/terse-tools/src/patch.ts` patches several Pi prototypes and reads component internals. It is the largest UI compatibility surface. The public tool renderer resolver and self-rendered shell are worth testing as a smaller implementation seam, but do not assume they can replace assistant thinking cards or every existing patch.

The custom input editor extends Pi's editor, so check the compaction-indicator color fix and hardware-cursor change in a real terminal. Check narrow/expanded tool rows, resumed sessions, themes, Kitty keybindings, overlay scrolling, and fullscreen mouse behavior. Unit/loader tests cannot prove these visual interactions.

Sources: [render context types](https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/src/core/extensions/types.ts), [TUI documentation](https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/docs/tui.md), [1.1/1.2 changelog](https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/CHANGELOG.md).

## 4. Useful operator changes

- Add published `$schema` URLs to setup examples and personal settings/models/keybindings/themes. The fetched settings schema has `additionalProperties: true`, so Apple Pi extension keys remain accepted but are not thereby validated. The theme schema is strict; reusable colors belong in `vars`, and unsupported metadata must be removed. Schema URLs are mutable, so this observation describes the fetched 2026-10-13 schemas, not a version-pinned guarantee.
- Use `PI_CLIPBOARD_OSC52=1` when a remote attach needs it, rather than building clipboard transport locally. First check any custom copy action actually uses Pi's clipboard utility. It complements rather than replaces local clipboard writes.
- OSC 7501 is useful for supporting terminals/dashboards. It does not replace `components/tmux-sessions` records: upstream docs explicitly state tmux/screen do not forward reports. Disk records supply session identity, liveness, cwd, and pane targeting for our picker; OSC status is a separate terminal surface.
- Per-key OpenRouter catalogs and corrected prices should be inherited from Pi's registry if OpenRouter profiles are used. No local catalog or guardrail projection is needed. New Haiku models are candidates for measured quick/pair/background profile trials, not automatic replacements.

Sources: [settings](https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/docs/settings.md), [settings schema](https://pi.dev/schemas/settings.schema.json), [theme schema](https://pi.dev/schemas/theme.schema.json), [program status](https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/docs/terminal-setup.md#program-status), [provider/clipboard release notes](https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/CHANGELOG.md).

## 5. Semantic changes worth testing

- `serializeConversation()` now omits thinking. At assessment time, Apple Pi also called it for provider-compaction fallback projections. That custom compaction/replay implementation was removed on 2026-10-27; the current package uses Pi's native LLM summarizer for every provider. See [the compaction decision](server-side-compaction.md#decision).
- Pi print mode now exits nonzero on output-token truncation. `components/pi-exec/src/agent-workers.ts` launches `--print --mode json` and already surfaces nonzero exits; verify a partial answer is retained with failed status. Interactive SDK children are separate: `components/subagents/src/agent-runner.ts` currently permits length stops with text. Decide whether their handoff should mark incompleteness too; the CLI fix does not change that local policy.
- MCP OAuth cancellation, post-refresh cancellation, issuer checks, lazy resources, and provider retry/strict-tool fallbacks are valuable upstream fixes. Keep them upstream; add local seam tests where bridge/fork behavior can bypass or obscure their effect. No local MCP list-JSON count parser was identified in this assessment.
- `+name/-name` CLI tool selection is handy for operator commands. Keep explicit SDK child tool scopes: relative default selection should not accidentally grant future tools to advisory/internal sessions.
- Classifier/image APIs may help a concrete classification or visual-evaluation workload. Neither a classifier service nor automatic profile routing is justified merely by new model availability. Measure a real case before adding a guest bridge.
- Removed experimental exports and chord have no identified local consumer. The remaining platform fixes mainly arrive with the upstream upgrade.

## Recommended sequence and validation limits

1. Establish a 1.2 development/test baseline for all four Pi packages; resolve union/API compatibility, especially notification start handling.
2. Validate custom wake-up lifecycle and prompt-cache stability across root sessions and relevant forks/children.
3. Add readiness metadata to composition entrypoints and address the native nested-call migration/result contract as a bounded follow-up.
4. Check prototype-based UI integrations in a real terminal; adopt public render data where useful.
5. Update setup schema examples and opt into terminal features only where needed.

Upgrade acceptance requires the proof criteria in sections 1–2, the real-terminal checks in section 3, and the repository's normal [validation sequence](../../AGENTS.md#validation-commands) against the upgraded dependencies. This assessment did not execute those steps.

Validation performed for this assessment was source/documentation inspection and HTTP retrieval of tagged sources/published schemas. No compatibility tests, full suite, live OAuth test, provider cache measurement, or 1.2 runtime upgrade were performed.
