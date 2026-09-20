# Pi 0.86.0 compatibility assessment

Date: 2026-09-19

## Verdict

Apple Pi is technically compatible with Pi 0.86.0 after a small migration, but it should not bump the four Pi development packages unchanged.

The production extensions compile and the complete Apple Pi validation sequence passes in an isolated 0.86.0 checkout after the proposed migration. The required source changes are confined to test providers and fixtures. Two local workarounds are obsolete and should be removed with the bump. One external dependency remains a release-policy blocker: the latest `pi-mcp-adapter` (`2.34.0`) does not declare Pi AI 0.86 support.

Recommended decision: prepare the migration, but wait for a `pi-mcp-adapter` release that accepts `@earendil-works/pi-ai@0.86.x`, unless the repository owner explicitly accepts an unsupported peer override after MCP runtime validation.

## Release summary

Pi 0.86.0 was released on 2026-09-19. Its main coding-agent changes are:

- Prompt-cache warming during long tool execution, with optional idle warming and cost-based decisions. The global `cacheWarming` setting defaults to `"streaming"`.
- Transcript-backed system-prompt and tool changes. Mid-conversation `before_agent_start` changes can survive resume and branch navigation while retaining cached prefixes.
- Per-model compaction budgets through `compaction.modelOverrides`.
- `/bug` diagnostics and report export/upload.
- An offline Radius model catalog.
- New extension APIs: `ctx.modelRegistry.stream()` / `streamSimple()`, `pi.on()` unsubscribe functions, exported hook event/result types, and `cache_warming_decision`.
- Compaction, branch-summary, and retry status indicators now use the custom editor's existing embedded-status opt-in.
- Strict-prefer JSON-schema sampling is enabled by default for Pi's built-in file and shell tools.

The breaking changes are:

1. Provider stream callbacks now receive `TranscriptContext`, not legacy `Context`. Custom providers must read the current prompt and tools from transcript system messages with `getCurrentSystemPrompt(context.messages)` and `getCurrentTools(context.messages)`.
2. `ToolCall.arguments` and `ToolResultMessage.details` are restricted to JSON-compatible values. `ToolResultMessage` is conditional and `JsonValue` arrays are readonly.
3. `user_bash` fails closed. A thrown error or invalid defined return aborts execution; `undefined` continues to later handlers or local execution.

Relevant fixes include:

- Mid-run threshold compaction no longer skips oversized trailing tool results (#9740).
- Fullscreen mode no longer reserves a blank row for a custom footer that renders zero rows (#8919).
- Automatic-compaction cancellation races were fixed.
- Signal-terminated shell commands now fail instead of reporting success with partial output.
- Session tree navigation no longer races active compaction progress UI.

The release also contains many provider/catalog, retry classification, clipboard, search, rendering, and model-specific fixes. These do not require Apple Pi changes.

## Apple Pi impact

### Required migration

1. Bump these packages together from `0.85.1` to `0.86.0` and update `package-lock.json`:
   - `@earendil-works/pi-agent-core`
   - `@earendil-works/pi-ai`
   - `@earendil-works/pi-coding-agent`
   - `@earendil-works/pi-tui`

2. Update Apple Pi's faux/custom provider tests to the transcript API:
   - `components/subagents/tests/subagent-clarify.test.ts`
   - `components/subagents/tests/subagent-runner-e2e.test.ts`
   - `components/xai-hosted-tools/tests/summarization.test.ts`
   - `tests/auto-compact-integration.test.ts`

   Replace reads of `context.systemPrompt` and `context.tools` with `getCurrentSystemPrompt(context.messages)` and `getCurrentTools(context.messages)`. Summary-provider test callbacks can distinguish an empty tool loadout with `getCurrentTools(context.messages).length === 0`.

   The pair-scope test must inspect the prompt delivered to the faux provider rather than `result.session.systemPrompt`; Pi 0.86 keeps per-run transcript prompt changes separate from the base session prompt property.

3. Make the tool-call fixture JSON-specific in `components/session-search/tests/fixtures.ts`: accept `JsonObject` instead of `Record<string, unknown>`.

4. Update `components/pair-programmer/tests/pair.test.mjs` for the new default retry setting `maxAgentDelayMs: 60_000`.

No production Apple Pi custom stream provider was found. `components/xai-hosted-tools` uses `before_provider_request`, not the provider-stream API. Production tool arguments/details audited in this assessment are ordinary JSON values.

### Remove obsolete compatibility code

#### Oversized tool-result cut point

Pi 0.86.0 fixes the upstream failure that `components/notebook/src/hooks/overflow-guard.ts` works around. Remove:

- `components/notebook/src/hooks/overflow-guard.ts`
- `components/notebook/tests/overflow-guard.test.ts`
- its registration and `Runtime` dependency from `extensions/auto-compact.ts`
- the context-hook allowlist entry in `tests/context-hooks.test.ts`
- the `turn_end` expectation from `tests/package-load.mjs`
- obsolete descriptions in `README.md`, `docs/context.md`, and `THIRD_PARTY_NOTICES.md`

Keep `extensions/compaction-safety.ts`. Its fail-closed policy for unsuccessful automatic compaction is separate from the removed cut-point workaround. Pi 0.86 still exposes the private `_runAutoCompaction` method that this extension patches, and the integration tests pass against it. The private-method dependency remains upgrade-sensitive.

#### Zero-row footer mutation

Pi 0.86.0 fixes the zero-row custom-footer layout itself. Remove Apple Pi's private TUI traversal:

- `collapseDockFooter()` and its calls from `components/input-editor/src/ui/input-editor.ts`
- its export from `components/input-editor/src/index.ts`
- its dedicated test from `components/input-editor/tests/input-editor.test.ts`

The custom editor already passes `embedWorkingStatus: true`, so it already opts into the 0.86 editor-border status behavior. After removing the stored TUI field usage, keep the constructor's `tuiForCard` argument as a normal parameter because it is still passed to `PiCustomEditor`.

### External dependency blocker

`pi-mcp-adapter@2.34.0` is still the latest published version. Its peer range is:

```text
@earendil-works/pi-ai: ^0.84.1 || ^0.85.0
```

With Pi 0.86.0 installed, `npm ls @earendil-works/pi-ai --all` exits with `ELSPROBLEMS` and marks the deduplicated 0.86.0 package invalid for that peer. The adapter's sampling code uses the stable `ModelRegistry.complete()` application API and compiled/loaded successfully in the isolated migration, so no concrete runtime break was found. That does not replace an upstream compatibility declaration.

### Compatible as-is

- The pair programmer's `user_bash` observer implicitly returns `undefined`, which remains the correct continue-propagation result. It should remain non-throwing.
- Apple Pi's production tool results use JSON-compatible details in the audited paths.
- `components/input-editor` already opts into embedded working status.
- The private automatic-compaction failure gate still installs and its success, failure, cancellation, concurrency, and oversized-result tests pass.
- The xAI compaction and hosted-tool integrations retain the intended split between ordinary requests and raw summary requests after their test provider migration.

### Optional follow-up

- Migrate additive `before_agent_start` prompt handlers in ledger, wiki, RTK, and pair-programmer code to structured `systemPromptOptions.sections`. This can preserve cached prefixes and make prompt changes transcript-native. It is an optimization, not a correctness requirement for 0.86.
- Consider per-model compaction overrides for materially different context windows. No Apple Pi code is required merely to expose the Pi setting.
- Decide whether the default `cacheWarming: "streaming"` cost policy is desirable for long `pi_exec`, subagent, and tool runs. Apple Pi needs no handler unless it wants to override Pi's cost decision.
- Visually verify the input editor's custom bouncing indicator with compaction/retry/branch-summary states now that all statuses share the embedded editor border.

## Validation evidence

An isolated copy of Apple Pi was installed with all four Pi packages at 0.86.0. The first typecheck found only the expected test migrations: JSON tool-call arguments and transcript-context prompt/tool access. The first full tests also exposed the new retry default and tests that classified summary calls through removed `Context.tools` fields.

After applying the migration and removing the two obsolete workarounds in the isolated copy:

- `npm run format:check` passed.
- `npm run lint` passed.
- `npm run typecheck` passed.
- `npm run test:unit` passed: 92 files, 1,057 tests after deleting the obsolete overflow-guard suite.
- `npm run test:pair` passed: 121/121.
- `npm run test:loader` passed.
- `npm run pack:check` passed before the final source-file deletion; the manifest already packages the owning component directory, so no new inclusion path is needed.
- Focused input-editor tests passed: 31/31 after removing the private footer mutation.
- `npm ls @earendil-works/pi-ai --all` failed only on `pi-mcp-adapter`'s undeclared 0.86 peer support.

The working repository was not upgraded during this assessment. All compatibility edits and dependency installation were made in `/tmp/apple-pi-086-audit.gqF42i/repo`.

## Primary sources

- [Pi coding-agent 0.86.0 changelog](https://github.com/earendil-works/pi/blob/v0.86.0/packages/coding-agent/CHANGELOG.md)
- [Pi AI 0.86.0 changelog](https://github.com/earendil-works/pi/blob/v0.86.0/packages/ai/CHANGELOG.md)
- [Pi TUI 0.86.0 changelog](https://github.com/earendil-works/pi/blob/v0.86.0/packages/tui/CHANGELOG.md)
- [Extension lifecycle and `before_agent_start`](https://github.com/earendil-works/pi/blob/v0.86.0/packages/coding-agent/docs/extensions.md)
- [Compaction settings and model overrides](https://github.com/earendil-works/pi/blob/v0.86.0/packages/coding-agent/docs/compaction.md)
- [Cache-warming settings](https://github.com/earendil-works/pi/blob/v0.86.0/packages/coding-agent/docs/settings.md)
- Pi 0.86.0 source tests: `packages/coding-agent/test/compaction.test.ts` and `packages/coding-agent/test/suite/agent-session-compaction.test.ts`
- Published npm metadata from `npm view pi-mcp-adapter version peerDependencies --json`
