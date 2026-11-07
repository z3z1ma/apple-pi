# Development conventions

## Modules

- Extension-facing components expose a thin `src/index.ts` entrypoint. It re-exports the component's public API and delegates installation to a cohesive domain module; library components expose their named modules directly.
- Extension wrappers register Pi integration only. Composition-heavy extensions may keep their installer together when lifecycle state is shared; independently testable formatting, persistence, worker, fetch, and dispatch code belongs in named sibling modules.
- Controllers, services, and algorithms stay whole when their state and dependency direction are cohesive. Split a module only at a production consumer, a test seam, or a one-way dependency boundary—not because it is long.
- UI rendering belongs in the owning component's `ui/` modules; do not create generic fleet, overlay, status, or progress abstractions without multiple production consumers.
- TypeScript uses NodeNext imports with `.js` suffixes throughout the repository.
- Components place production TypeScript in `src/` and component-specific tests in `tests/`; root integration tests remain under `tests/`. Third-party attribution and license text are centralized in `THIRD_PARTY_NOTICES.md`.

## Retained cohesive modules

`PairRuntime` remains intact because it owns one state machine with shared lifecycle state. Splitting it by file length would obscure ownership without creating a consumer or test seam.

## Capability guidance

Treat the harness as a small computational world rather than a catalog of unrelated tools:

- Tool names and argument shapes should map directly to familiar model priors.
- A tool description and schema own exact invocation semantics and local constraints.
- `promptSnippet`, `promptGuidelines`, and explicit system-prompt hooks own concise capability selection, relationships to neighboring native tools, mental models, and the composition patterns needed for ordinary use.
- Product documentation owns the complete human and maintainer contract. It is invisible to the running model and contributes no runtime guidance.
- Skills own repeatable engineering procedures or optional progressive disclosure. A model should not need to discover a skill before it can use a native tool correctly.

Extensions add system-prompt text as named sections on `event.systemPromptOptions.sections` through `setSystemPromptSection` in `components/shared/src/system-prompt-section.ts`. Pi diffs these sections and appends changes and removals as system messages instead of rewriting the earlier transcript. Use this path for mutable identity, reporting, catalogs and other prompt context, and use Pi's loadout APIs for tool changes. A returned `systemPrompt` or `forceSystemPrompt` instead forces the leading provider prompt, even though the transcript still records sections. Preserve the structured path and test that prior provider-request messages remain an unchanged prefix after a mutation. Some providers require a checkpoint when they cannot represent a transition; this can invalidate their cache. Structural prefix tests are not measured cache-hit proof. A session with a custom preamble, such as the [`/btw`](btw.md) session, adds its tool summaries and usage rules as `<tools>` and `<rules>` sections itself, because Pi renders those only under its default preamble.

Avoid duplicating the same manual across these layers. Put each fact at the narrowest layer that is always present when the model needs it. Before deleting a skill, classify its content and migrate every ordinary-use concept that would otherwise disappear from runtime instructions; tests should assert the retained prompt-bearing surface rather than pointing to documentation.

## Skill composition

Pi loads every skill into its resource catalog, but removes `disable-model-invocation: true` skills from the model's automatic system-prompt catalog. A user's `/skill:<name>` command still resolves against the full catalog and expands the chosen body with its absolute location and base directory.

Choose the composition path by intent:

- When one packaged skill needs another procedure during the current run, use an explicit relative Markdown link such as `../interrogate-to-design/SKILL.md` and tell the model to read and follow it. This anchors the compatible packaged procedure and works whether the target is model-visible or human-only. The parent invocation owns the authorized workflow scope; the referenced skill supplies procedure.
- When prose only routes a future request toward a model-visible skill, its installed name is enough because Pi's system-prompt catalog supplies the trigger and absolute path.
- When the next workflow requires a separate human invocation, report `/skill:<name>`. This lets Pi expand model-visible or human-only targets through the full resource catalog without implying that the current skill invoked them.
- When only one supporting procedure is needed, link that exact reference file rather than loading its complete parent skill.

Direct skill-to-skill references need no runtime invocation bridge.

## Execution paths

Execution-context suffixes are contracts:

- `.runtime.ts` marks a strip-only Node daemon entry, not every module it imports.
- `.worker.ts` marks a worker-thread entry, constructed with an explicit file URL.
- `.hot.ts` marks per-request/event work: use bounded reads and asynchronous child processes.

`node lint/path-contracts.mjs` follows local value imports, re-exports, literal dynamic imports and execution-entry URLs from those files. It rejects non-erasable declarations/parameter properties and UI imports in the Node closure; hot restrictions also follow local dependencies. Type-only dependencies are not executed. The hot-path GritQL rule in `.pi/rules/` provides the same direct API restriction in Biome and the edit/write gate. These are static source checks, not a sandbox for third-party packages or computed code loading.

## Quality commands

```bash
npm run format
npm run format:check
npm run lint
npm run typecheck
npm test
npm run pack:check
```

After changing `components/browser-pages/web/`, run `npm run build:web` and commit the pages it writes to `components/browser-pages/dist/`. `npm test` fails while the committed page is stale. `npm run typecheck` checks the page with `tsconfig.web.json`.

`npm run typecheck` checks the web half (`tsconfig.web.json`) only after the Node half passes, so web errors hide behind Node errors; rerun it after every fix.

Biome's `useHookAtTopLevel` treats any function named `use...` as a React hook, and `noFocusedTests` reads any call to a local `fit(...)` as a focused test. Name test helpers without those forms.

## Agent Workplace

[Agent Workplace](agent-workplace.md) lives in `apps/agent-workplace/`: `src/backend/` is a plain Node module (no Electron import), `src/electron/` is the main process and the preload, `web/` contains the React Workplace chat/mail interface and the Phaser World with its React overlays, and `themes/` holds the theme packs.

- **Build:** after changing `web/` or `src/`, run `npm run build:workplace` and commit what it writes to `apps/agent-workplace/dist/` (the world UI, `electron/main.js`, and `electron/preload.cjs`); Electron runs only the built files, and Pi installs git packages without dev dependencies. `apps/agent-workplace/tests/build.test.ts` fails while `dist/` is stale. The headless-Chrome tests load the built UI from `dist/`, so rebuild before running them.
- **Tests:** the backend runs in Vitest against a real session-state runtime with fake bridges and faux Pi sessions; the built UI runs in headless Chrome (`/Applications/Google Chrome.app`, through `playwright-core`) against a fixture `window.agentWorkplace`. `AGENT_WORLD_SHOTS=<dir>` makes the UI tests save screenshots there. They run as their own step, `npm run test:workplace`, after `test:unit` (which excludes `apps/`): run together, the many Chrome instances made unrelated suites time out. It uses a 30 s hook timeout, because launching Chrome under heavy load took longer than the 10 s default.
- **Start-up check:** `npm run check:workplace-start` starts the built app with the installed Electron (or the binary named by `AGENT_WORLD_ELECTRON`) in a scratch agent directory with its own runtime, captures the window once the world has drawn, and fails unless the capture shows a rendered world. It needs Electron installed (run `/workplace` once) and a display; the window shows for a few seconds. It is not part of `npm test`.
- **Workplace checks:** from a checkout with dev dependencies, `node apps/agent-workplace/scripts/workplace-smoke.mjs [screenshot-directory]` exercises the built Chat/Mail UI against an in-memory bridge in headless Chrome. `node apps/agent-workplace/scripts/workplace-electron-check.mjs` checks bare Chat startup, real Monaco editing and guarded file/Git IPC, observational profiles, Org navigation/progress and the explicit World round trip in an isolated Electron window. Both need a current build; the latter needs the installed Electron and a display. They send no live messages. Historical ledger copies are evidence, not the maintained validation entrypoints. For focused Vitest runs on this shared machine, select relevant files and use `--maxWorkers=1`.
- **Chrome test pitfalls:** these cost debugging rounds before they were understood.
  - Wait for a rendered selector before pressing keys, and take screenshots with `animations="disabled"`: CSS animations never advance in headless Chrome. Collect `pageerror` and console errors in every test.
  - Playwright's web-first `expect(locator)` matchers fail under Vitest; use `locator.waitFor` and `vi.waitFor`. A `vi.waitFor` longer than 5 s needs the test's own timeout raised, and a menu action that walks first needs several seconds.
  - Clicking a visually hidden radio waits until the test times out with no clear error: click its label text and assert `isChecked()`. Rerun a hanging test with `--testTimeout=60000` to see Playwright's own locator error.
  - Make only the children of `.aw-places` clickable (`.aw-places > *, .aw-places > * *`): the container covers the whole window, so making it clickable swallows every right-click on the world.
  - Check the preload API's union type before writing a fake. `readThread` returns `{ ok: true, page }`; a wrong shape shows only as a red banner in the screenshot. `conversation(id)` returns the full `ConversationPage` (`{ ok: true, entries, before, missing }`); without `ok` the DM renders empty with no error and the test only times out.
  - `\u00b7` typed in JSX text prints literally; put it in a string expression.
  - The embedded World renders and accepts clicks before its top-level awaits connect its stores, so an early click silently does nothing: wait for its `canvas` first. To inspect a built store's live state, evaluate in the frame `await new Function("u", "return import(u)")(new URL("assets/world-store.js", location.href).href)`; the same URL gives the same module instance, so you can read a store or wrap an exported method. A plain `import()` inside `evaluate` fails because Vitest rewrites it.
- **Auditing on real data:** to check Workplace against the operator's real organization without touching it, run the read-only live mirror: `node --import ./components/session-state/src/register.mjs .ledger/history/202611012305-front-desk-continuous-organization/live-mirror.ts <outDir> [tour|chat|rest]`. It drives the built UI in headless Chrome with real backends for reads and refuses mutations and catch-up. It showed real-data defects that fixture screenshots hid.
- **Theme packs:** check a pack before opening it in the world with `node --import ./components/session-state/src/register.mjs apps/agent-workplace/src/check-theme.ts [apps/agent-workplace/themes/<id>]`; it prints each problem as `<pack>/<file>: <fault>` and exits 1 when there is any, and without a directory it checks every pack. The pack format is in `apps/agent-workplace/themes/README.md`.
- **Art pipeline:** `apps/agent-workplace/art/` holds the style guide (`STYLE.md`), the per-theme briefs (`briefs/`), and `pipeline.py` (`uv run --script`), which generates art with Codex and then cuts, scales, quantizes to 256 colours, and checks it (`pipeline.py batch <theme>`, then `pipeline.py build <theme>`). Raw generated art stays local in `art/raw/`, which git ignores; the cleaned art in `themes/<theme>/` is what ships and is the source of truth. `npm run test:art` runs the pipeline's tests.

Biome is the repository formatter and lint runner. It formats all TypeScript and JavaScript with tabs through one shared configuration. `format:check` is the no-write CI check; `lint` enables Biome's recommended correctness rules, high-signal debugger and loose-equality checks, and a function-level cognitive-complexity limit of 50. `noExplicitAny` remains off for the Pi API's intentionally untyped generic boundary, non-null assertions remain off in existing test setup, and control-character regex detection remains off because ANSI/control-character sanitizers are intentional. Any complexity suppression must document the specific cohesive state-machine or algorithm boundary it protects.

## Scripted SDK tests

- Reuse [`tests/helpers/faux-session.ts`](../tests/helpers/faux-session.ts) to test real Pi sessions driven by scripted model responses in a temporary workspace.
- Custom provider streams must handle both cancellation during a request and an `AbortSignal` already aborted when the request starts. Emit an aborted response in either case; Pi can make a final request after cancellation. Verify cancellation through the provider signal. For fork cancellation, also confirm that the parent session can continue, as in the [forked continuation tests](../components/shared/tests/forked-continuation.test.ts).
- Supply explicit, nonzero usage on returned assistant-message fixtures when testing accounting. `fauxAssistantMessage` defaults its usage counters to zero.
- Prove each new regression test red at the previous commit in a detached worktree (`git worktree add --detach`, with a `node_modules` symlink), never by restoring shared files from `git show HEAD:`; a test once passed on old code because its fixture changed a field the comparison never read. Before removing the worktree, unlink only its `node_modules` symlink (`node_modules/` does not ignore symlinks) and confirm the removal with `git worktree list`.

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

## Sources

Sources that misled earlier work in this repository, and what to read instead:

- **Search summaries** of a recent product feature can be truncated or secondhand; confirm them against an official source.
- **Upstream Pi facts** come from the tagged file on `raw.githubusercontent.com`. For a minimum-version safety claim, read the consuming code at each patch tag, not release notes: Git 2.45.0 parses `GIT_NO_LAZY_FETCH`, but only 2.45.1's `promisor-remote.c` honours it.
- **The installed Pi package:** grep `dist/core/` and `dist/modes/`, not `dist/bundle/chunks/`, whose minified single lines flood the output.
- **npm versions:** fetch `https://registry.npmjs.org/-/package/<name>/dist-tags`, then `/<name>/<version>`. Prefer these narrow endpoints to the much larger full packument.
- **A reference project's features** live in its ADRs, specs and tool contract as well as its README; read them before saying it lacks one.
- **Citations into source:** take line numbers from `rg -n`, and check both ends of a cited range against the file's length. Citing a test's source is not evidence of running it.

## Ledger bundles here

- Scripts kept in `.ledger/<task>/` find the repository root by walking up to a marker directory, not a fixed number of parents: closing the task moves the bundle under `history/`.
- After archiving a task, check its relative links from the extra `history/` level, move any `.context/.ledger/<task>/` to `.context/.ledger/history/<task>/` with its `Coupled:` paths, and rerun `context_lint`.
- Write tickets and map gists in plain words or wiki-glossary terms, not terms only one session defined. When a ticket goes out of scope or moves, check resolved tickets for `Handed off` lines pointing at it.

## Documentation edits

- Before renaming or splitting a doc heading, search `docs`, `AGENTS.md`, `README.md` and `.wiki` for links to `<file>.md#<anchor>`; other docs link to section anchors.
- After a word-level bulk rename, grep for broken articles ("an coordinator"), circular sentences, and name-history lines the replace also rewrote; write history lines after the replace. After renaming a packaged skill, tell long-lived sessions that cite its old path.
