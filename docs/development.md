# Development conventions

## Modules

- Extension-facing components expose a thin `src/index.ts` entrypoint. It re-exports the component's public API and delegates installation to a cohesive domain module; library components expose their named modules directly.
- Extension wrappers register Pi integration only. Composition-heavy extensions may keep their installer together when lifecycle state is shared; independently testable formatting, persistence, worker, fetch, and dispatch code belongs in named sibling modules.
- Controllers, services, and algorithms stay whole when their state and dependency direction are cohesive. Split a module only at a production consumer, a test seam, or a one-way dependency boundary—not because it is long.
- UI rendering belongs in the owning component's `ui/` modules; do not create generic fleet, overlay, status, or progress abstractions without multiple production consumers.
- TypeScript uses NodeNext imports with `.js` suffixes throughout the repository.
- Components place production TypeScript in `src/` and component-specific tests in `tests/`; root integration tests remain under `tests/`. Third-party attribution and license text are centralized in `THIRD_PARTY_NOTICES.md`.

## Retained cohesive modules

`PairRuntime`, Pi Exec's invocation controller, `agent-runner.ts`, and `agent-manager.ts` remain intact because they each own a single state machine or algorithm with shared lifecycle state. Splitting them by file length would obscure ownership without creating a consumer or test seam.

## Capability guidance

Treat the harness as a small computational world rather than a catalog of unrelated tools:

- Tool names and argument shapes should map directly to familiar model priors.
- A tool description and schema own exact invocation semantics and local constraints.
- `promptSnippet`, `promptGuidelines`, and explicit system-prompt hooks own concise capability selection, relationships to neighboring native tools, mental models, and the composition patterns needed for ordinary use.
- Product documentation owns the complete human and maintainer contract. It is invisible to the running model and contributes no runtime guidance.
- Skills own repeatable engineering procedures or optional progressive disclosure. A model should not need to discover a skill before it can use a native tool correctly.

Extensions add system-prompt text as named sections on `event.systemPromptOptions.sections` through `setSystemPromptSection` in `components/shared/src/system-prompt-section.ts`. Returning `systemPrompt` from `before_agent_start` would force one opaque prompt for the whole run and discard Pi's section structure. A subagent with a custom preamble receives its tool summaries and usage rules as `<tools>` and `<rules>` sections, because Pi renders those only under its default preamble.

Avoid duplicating the same manual across these layers. Put each fact at the narrowest layer that is always present when the model needs it. Before deleting a skill, classify its content and migrate every ordinary-use concept that would otherwise disappear from runtime instructions; tests should assert the retained prompt-bearing surface rather than pointing to documentation.

## Skill composition

Pi loads every skill into its resource catalog, but removes `disable-model-invocation: true` skills from the model's automatic system-prompt catalog. A user's `/skill:<name>` command still resolves against the full catalog and expands the chosen body with its absolute location and base directory.

Choose the composition path by intent:

- When one packaged skill needs another procedure during the current run, use an explicit relative Markdown link such as `../interrogate-to-design/SKILL.md` and tell the model to read and follow it. This anchors the compatible packaged procedure and works whether the target is model-visible or human-only. The parent invocation owns the authorized workflow scope; the referenced skill supplies procedure.
- When prose only routes a future request toward a model-visible skill, its installed name is enough because Pi's system-prompt catalog supplies the trigger and absolute path.
- When the next workflow requires a separate human invocation, report `/skill:<name>`. This lets Pi expand model-visible or human-only targets through the full resource catalog without implying that the current skill invoked them.
- When only one supporting procedure is needed, link that exact reference file rather than loading its complete parent skill.

Pi Exec's `skills.list()` and `skills.body()` remain introspection APIs for model-visible skills only. Direct skill-to-skill references need no runtime invocation bridge.

## Quality commands

```bash
npm run format
npm run format:check
npm run lint
npm run typecheck
npm test
npm run pack:check
```

Biome is the repository formatter and lint runner. It formats all TypeScript and JavaScript with tabs through one shared configuration. `format:check` is the no-write CI check; `lint` enables Biome's recommended correctness rules, high-signal debugger and loose-equality checks, and a function-level cognitive-complexity limit of 50. `noExplicitAny` remains off for the Pi API's intentionally untyped generic boundary, non-null assertions remain off in existing test setup, and control-character regex detection remains off because ANSI/control-character sanitizers are intentional. Any complexity suppression must document the specific cohesive state-machine or algorithm boundary it protects.

## Scripted SDK tests

- Reuse [`tests/helpers/faux-session.ts`](../tests/helpers/faux-session.ts) to test real Pi sessions driven by scripted model responses in a temporary workspace.
- Custom provider streams must handle both cancellation during a request and an `AbortSignal` already aborted when the request starts. Emit an aborted response in either case; Pi can make a final request after cancellation. Verify cancellation through the provider signal. For child or fork cancellation, also confirm that the parent session can continue, as in the [clarification tests](../components/subagents/tests/subagent-clarify.test.ts).
- Supply explicit, nonzero usage on returned assistant-message fixtures when testing accounting. `fauxAssistantMessage` defaults its usage counters to zero.

## Manual TUI checks

Unit tests use a fake `tui`; they cannot prove real focus routing, mouse dispatch, or overlay stacking. Check those in a real Pi driven through tmux:

```bash
tmux new-session -d -s check -x 160 -y 45 "pi -e path/to/extension.ts"
tmux send-keys -t check '/command' Enter    # M-g sends Alt+G; also Escape, BSpace
tmux capture-pane -t check -p | grep 'expected text'
tmux resize-window -t check -x 90           # responsive overlays
tmux kill-session -t check
```

The pane can be larger than the requested size when a client is attached; read it with `tmux display -t check -p '#{pane_width}'`. Fullscreen mouse input can be sent as SGR sequences, for example `tmux send-keys -t check -l $'\e[<64;COL;ROWM'` for wheel up.
