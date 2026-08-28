# Repository guide for agents

This file applies to the entire repository. It is a durable map and operating guide, not a copy of the user manual or a catalogue of every current symbol. Prefer the linked source of truth when details disagree.

## Read this first

Before changing anything:

1. Run `git status --short --branch` and preserve all existing work. This repository is often developed through multi-file architectural changes; do not assume a dirty tree is disposable.
2. Read `README.md` for the package catalog and install path, then the relevant `docs/` page for product behavior and feature boundaries.
3. Read `docs/development.md` for module and formatting conventions.
4. If the work is governed by `.ledger`, read `.ledger/INDEX.md`, the selected task's `task.md`, and every active record it references. Resolve closed dependencies through `.ledger/history/`. See `docs/ledger.md` for the workbench model.
5. Inspect the manifest and test configuration before adding a new path. Packaging, TypeScript, Vitest, and the extension loader each have explicit inclusion boundaries.

Authority is split deliberately:

- `package.json` is the machine-readable package, extension, skill, script, engine, and dependency contract.
- `README.md` is the human catalog and install path.
- `docs/` owns user-facing feature contracts. `docs/boundaries.md` records adopted and deliberately rejected ideas.
- `docs/development.md` owns coding and module conventions.
- `docs/ledger.md` owns the durable `.ledger` workflow.
- `docs/todos.md` owns active-execution checklist semantics, storage, and its boundary with backlog and Ledger.
- Tests own executable invariants, but a test can still encode an obsolete contract; compare it with current product documentation and instructions.
- This file explains how those pieces fit together. Keep it conceptual so ordinary feature additions do not require updating it.

## What this repository is

`apple-pi` is one installable Pi package that composes Alex's coding-agent environment. It is not an application server and not a monorepo of separately published packages. The root manifest is the only package boundary; directories under `components/` are internal source organization.

At a high level, the package adds five kinds of capability to Pi:

1. **Turn assistance and interaction** — persistent read-only Pair supervision with episodic Advisor adjudication, plus a structured user-question tool.
2. **Context continuity** — xAI server-side or Pi default compaction, Pair-maintained sourced memory, and two complementary recall paths.
3. **Execution tracking** — branch-aware active to-dos, distinct from parked backlog ideas and durable Ledger records.
4. **Execution and delegation** — a bounded JavaScript composition runtime plus interactive specialist subagents.
5. **Workflow guidance** — packaged skills for review, ledger task lifecycles, and fresh-context Ralph loops, plus explicit prompt templates such as proposal-first distillation.
6. **Integration bridges** — MCP through an owned integration boundary and provider-specific hosted-tool injection for supported xAI requests.

The design goal is an integrated Pi environment with one implementation of each responsibility. Features that are intentionally delegated to Pi or a dependency should not be copied locally.

## Runtime mental model

Pi discovers the package through the `pi` section of `package.json`. Each configured extension entrypoint installs tools, commands, event hooks, renderers, or provider hooks into Pi. Most files under `extensions/` are thin integration wrappers over cohesive code in `components/`. The composition-heavy exec runtime stays in named `extensions/runtime-*` modules because those modules share one extension lifecycle and worker protocol. Ledger is another deliberate exception: its small add/close/prompt integration lives in `extensions/ledger.ts`, while the shared contract text and lifecycle procedures live with their actual consumers rather than behind a ledger domain component.

There are three execution contexts to keep distinct:

- **Root Pi session** — owns the normal extension surface, interactive subagent manager, and `pi_exec`.
- **Interactive child session** — is a real Pi session with its own context and persistence. It does not discover package extensions. Ordinary children load Codex fast mode, the proactive overflow guard, ledger, `session_search`, and MCP via explicit paths (`--no-extensions` plus `-e`), and may load the Pair sidecar when `pair: true`; the internal `/btw` child loads only Codex fast mode and the mandatory overflow guard. A child may inherit skills unless `isolated`. It must not create another top-level subagent manager or gain `pi_exec` as a way around nested-delegation limits.
- **`pi_exec` guest/worker** — runs disposable JavaScript with an explicit bridge to selected Pi tools, captured extension tools, fetch, and model workers. It does not receive ambient Node filesystem or process authority. Nested model workers receive only explicitly granted core tools and bound context. They load Codex fast mode, the proactive overflow guard, ledger, and `session_search` extensions the same `--no-extensions` plus `-e` way, and they do not load `pi_exec`, the subagent manager, or MCP.

When debugging a missing tool or duplicated lifecycle effect, first establish which of these contexts is executing.

## Architecture map

| Area | Responsibility | Important relationships |
| --- | --- | --- |
| `extensions/` | Pi-facing installers and the exec guest/worker implementation | Entries are selected by `package.json`. Keep ordinary wrappers thin; shared-lifecycle runtime modules may remain cohesive here. |
| `components/pair-programmer/` | Optional persistent read-only supervision of main-agent turns | Uses the user-global `pair` model profile and can route typed escalations through the host-controlled deep Advisor sub-agent; neither role may implement. |
| `components/ask-user-question/` | Structured questionnaire schema, TUI, RPC fallback, and tool registration | Interactive and RPC behavior should preserve the same question semantics. |
| `components/backlog/` | Branch-aware session backlog state, model add/read/take tools, and the human `/backlog` manager | Backlog items are parked observations, not active execution steps or Ledger commitments. The model may remove an item when it begins active work, or after jointly agreed promotion succeeds; editing, arbitrary deletion, and ordering remain human-owned. |
| `components/todos/` | Branch-aware active-execution checklist, `/todos`, reminder/cleanup lifecycle, and managed subagent execution | To-dos are ephemeral execution state, not Ledger acceptance evidence. Default snapshots follow session branches; trusted shared-project state is explicitly opted in and safely locked. |
| `components/session-search/` | Transcript history search (`session_search`) | Search only. Compaction is xAI server-side or Pi's default summarizer, plus the Pair memory packet. |
| `components/memory/` | Model-generated observations/reflections and exact source recall | Persists records in Pi's append-only session JSONL and appends the folded packet to the conversation tail after any compaction. |
| `components/xai-context-compaction/` | xAI server-side Responses compaction | Owns `session_before_compact` for xAI Responses models; injects the newest opaque item on later requests. |
| `components/subagents/` | Agent type discovery, model routing, execution, nesting, persistence, steering, TUI views, and the private `/btw` side conversation | Serves the interactive `Agent` surface, managed workers used by `pi_exec`, and one internal read-only BTW session while keeping ownership and depth boundaries explicit. |
| `components/shared/` | Small primitives genuinely shared across subsystem boundaries | Do not turn this into a generic utility dumping ground. A helper belongs here only when multiple production consumers need the same semantics. |
| `components/xai-hosted-tools/` | Provider-request transformation for xAI hosted tools | Changes only eligible xAI Responses requests and avoids duplicate tool injection. |
| `components/tmux-sessions/` | Publishes per-session `busy`/`idle`/`waiting` status to disk so bundled tmux scripts can list, preview, and jump across live Pi sessions | The extension (root `tui` sessions only) owns the on-disk record contract in `src/state.ts`; the bash scripts and `pi_session_manager.tmux` are the consumer. Adapted from tmux-claude-session-manager; the disk record replaces Claude's `agents --json`. |
| Ledger implementation | Add/close tools and `before_agent_start` wiring in `extensions/ledger.ts`; contract text in `components/shared/src/ledger-system-prompt.ts`; lifecycle procedures in the descriptively named packages under `skills/`; durable semantics in `docs/ledger.md` | Root, children, and `pi_exec` workers learn the contract by loading the ledger extension. Children also load `session_search` and MCP; workers load `session_search`. The Pair does not receive the contract. There is deliberately no ledger catalog, operations hub, active-task pointer, or `components/ledger/` domain. |
| `skills/` | On-demand procedural guidance loaded by Pi | The software-engineering skills fuse design, research, specification, planning, execution, review, verification, and finishing with Ledger state. Review and Ralph author `pi_exec` programs rather than hidden runtime engines. |
| `prompts/` | Explicitly invoked prompt templates | `/distill` proposes durable lessons for the right existing owner and waits for operator approval before writing. Keep prompt templates stateless; use an extension only when runtime behavior is actually required. |
| `tests/` | Cross-component and package integration checks | Includes extension loading, runtime behavior, package surface, and end-to-end integration seams. |
| `docs/` | Feature contracts, maintainer conventions, and adopted/rejected boundaries | Keep durable behavior here; do not use `.ledger` as a second project wiki. |
| `.ledger/` | Optional task-local workbench for non-trivial work | It is execution state and evidence, not product runtime state. Storage/commit policy belongs to the repository owner. |

## Core flows and invariants

### Package and extension loading

- The package ships source ESM; there is no generated build directory or separate compilation artifact.
- TypeScript uses NodeNext semantics, and relative TypeScript imports use `.js` suffixes because that is the runtime ESM path.
- The root manifest's extension list, skills and prompt paths, published `files` allowlist, and dependency declarations are part of the product surface.
- The package-load test is the executable smoke test for loading an explicit checkout entrypoint list and checking the expected tool/command boundary. It does not discover entries from the manifest or load the packed tarball, so keep its list aligned with `package.json` and inspect packaging separately.

### Context and memory

- There is **one compaction hook owner**. On xAI Responses models that is server-side `/responses/compact`; otherwise Pi's default summarizer runs. Pair memory does not register a compact hook; it appends its packet to the conversation tail after a compaction entry exists.
- Do not reintroduce a local structured compact compiler. Compaction is xAI `/responses/compact` or Pi's default summarizer; Pair memory only appends its packet afterwards.
- Session-history search and memory-source lookup are intentionally separate: one progressively searches transcript/file-operation history; the other resolves a known memory ID to source evidence.
- Pair memory is authoritative in Pi's append-only session JSONL. Do not add a project-local mirror without an explicit storage, privacy, merge, and migration design.
- Reload, switch, fork, and shutdown paths matter. Any asynchronous work holding a Pi extension context must stop or re-prime when that context becomes stale.

### Exec and subagents

- `pi_exec` is a bounded composition bridge, not an unrestricted Node evaluator. Preserve call, concurrency, agent, memory, output, and time limits; preserve cancellation and durable nested-operation traces.
- Guest APIs take explicit serializable arguments. New capabilities should cross a deliberate host bridge and participate in budgeting, tracing, and cancellation.
- Extension tools can be captured for composition, but provider-private behavior that is not represented as a Pi tool is not automatically available.
- `Agent` and `pi_exec` workers share agent-type discovery but serve different use cases: interactive collaboration versus programmatic composition.
- Child sessions and `pi_exec` workers do not discover package extensions. Ordinary children load Codex fast mode, the proactive overflow guard, ledger, `session_search`, and MCP via explicit paths under `--no-extensions`; `pair: true` adds the Pair sidecar, and direct public `Agent` children receive the root-owned `escalate_to_parent` custom tool. The internal `/btw` child loads only Codex fast mode and the mandatory overflow guard. Workers load Codex fast mode, the overflow guard, ledger, and `session_search` explicitly; managed workers and nested children do not receive root escalation. Recursion is prevented because none load `pi_exec` or the top-level subagent manager. Pair memory maintenance stays with the root Pair integration.
- Child sessions must not bypass manager ownership, nesting depth, tool policy, or root-only capabilities. Avoid global registries unless they are explicitly process-scoped integration points with lifecycle cleanup.
- Nested `pi_exec` operations are not separate top-level Pi tool calls. Policy extensions that gate only top-level `tool_call` events see the outer `pi_exec`, not every bridged operation; deployments needing an outer per-call gate must treat `pi_exec` itself as the capability boundary.
- Persisted child sessions are Pi sessions. Do not add a second transcript or memory store merely for the subagent feature.

### Ledger, review, and Ralph

- Ledger is the shared authority, cold-start memory, execution record, and learning loop beneath the packaged lifecycle skills. It distinguishes shaping, orchestration, and execution even when one session performs them sequentially.
- Execution-changing assumptions are record-backed, user-ratified, or blocking. Worker reports are claims; observations carry limits; review independently tries to falsify completion; closure reconciles acceptance evidence, dependencies, blocking records, active-plan state, review dispositions, and the retrospective.
- `.ledger` is a plain-Markdown task graph for work that benefits from a cold-start contract. The method scales down to disciplined minimalism for exact trivial changes rather than requiring ceremony.
- `ledger_add` creates new structure only. `ledger_close` archives a live task as `done` or `cancelled` into `.ledger/history/` without judging completeness. Existing tasks are otherwise inspected and edited with ordinary repository tools.
- Task intent, acceptance, and status live in `task.md`; execution progress lives in plans, validation and review observations live under `evidence/`, and learning/improvement lives in `retrospective.md`. `.ledger/INDEX.md` is live navigation with title and description, and `.ledger/history/INDEX.md` records terminal status plus that same search text.
- Review and Ralph are packaged skills over `pi_exec`. Do not recreate obsolete review/Ralph commands, engines, or parallel state stores.
- Ralph iterations are fresh-context implementation workers. The calling session bounds iterations and owns subsequent review and integration; prepared Ledger tasks are one supported state owner, not a requirement for the general loop.
- Durable lessons leave the task bundle for their real owner: normal docs, tests, an ADR convention, a runbook, or a reusable skill.

### External integrations

- MCP protocol, transport, authentication, approvals, and UI belong to the pinned adapter dependency. This repository owns installation and composition boundaries, not a fork of that implementation.
- The MCP adapter's separate scripting runtime is intentionally not exposed because `pi_exec` is the single composition runtime.
- Provider-specific payload hooks must be narrowly gated by provider/API and idempotent when a caller already supplied the capability.
- Third-party provenance and licensing belong in `THIRD_PARTY_NOTICES.md`; do not edit vendored `node_modules/` source.

`docs/boundaries.md` records adopted and deliberately rejected ideas. Consult it before restoring an absent feature: absence is often an architectural choice, not unfinished work.

## Where a change should go

Use the narrowest production owner:

- Pi registration or event wiring: `extensions/`.
- Domain behavior with independent tests: the owning `components/<domain>/src/` tree.
- Terminal rendering for a component: that component's `ui/` modules.
- Logic used by multiple real subsystems with identical semantics: `components/shared/`.
- User-facing package behavior and configuration: the relevant `docs/` page. Keep `README.md` as the catalog and install path.
- Session backlog behavior and UI: `components/backlog/`; keep its state in Pi session entries rather than repository files.
- Active to-do behavior, persistence, UI, and execution: `components/todos/`; preserve its explicit session/project storage and managed-subagent boundaries.
- Stable maintainer conventions or architecture rationale: `docs/`.
- Ledger behavior: keep add/close/prompt wiring in `extensions/ledger.ts`, shared contract text in `components/shared/src/ledger-system-prompt.ts`, lifecycle procedures in their owning descriptively named skill directories, and semantics in `docs/ledger.md`. Do not recreate a ledger domain component, parser/catalog, operations hub, or active-task pointer without an explicit new product contract.
- Repeatable agent procedure: `skills/<name>/SKILL.md` and, when needed, its local `references/`.
- Explicit user-invoked model workflow that needs no runtime state: `prompts/<command>.md`.
- Task-specific investigation, decisions, or evidence: the governing `.ledger` bundle, not production code.

Do not add metadata, fixtures, schemas, loaders, or policy modules without identifying the production consumer and the incorrect behavior prevented by the addition. Avoid compatibility wrappers, duplicate implementations, dormant toggles, speculative abstractions, and “new/v2” paths unless a real migration contract requires coexistence.

## Development setup

Use the root package only:

```bash
npm install
```

For a clean reproducible checkout, `npm ci` is appropriate. Follow the Node engine declared in `package.json`.

Install the checkout into Pi using the command documented in `README.md` when exercising the package interactively. Do not publish, globally install, or change project activation as part of routine validation unless the operator authorizes it.

## Validation commands

The normal proof sequence is:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run pack:check
```

Useful narrower commands are defined in `package.json`:

- `test:unit` runs Vitest suites for components and root integration.
- `test:pair` runs the pair's offline Node harness and expects the `pi` executable on `PATH`; its networked E2E mode is opt-in.
- `test:loader` loads an explicit list of checkout extension entrypoints and checks the exposed surface.
- `pack:check` prints npm's dry-run package contents. Inspect that list for expected source; the command does not assert completeness or test the tarball in an installed environment.

Run the cheapest falsifying check while iterating, then the full relevant suite before declaring completion. A passing unit suite does not prove package loading, and a successful package dry run does not prove behavior. Some session-search tests write temporary session JSONL; they must not touch real Pi session files.

`npm run format` writes across broad repository paths. In a dirty working tree, prefer formatting only files you changed (for example with Biome's path arguments), then run the non-writing repository check. Never use a blanket formatter as accidental cleanup of someone else's work.

When adding a new source or test area, inspect all of these inclusion points:

1. `package.json` published `files` and Pi entry configuration.
2. `tsconfig.json` includes.
3. `vitest.config.ts` test includes, or the dedicated non-Vitest runner.
4. `tests/package-load.mjs` if the public runtime surface changes.
5. Formatting/lint script paths in `package.json`.

A file that works from the checkout but is absent from the package tarball is a release defect.

## Coding conventions

- Use strict TypeScript and ESM. Keep `.js` suffixes on relative imports.
- Follow `.editorconfig`: tabs for code; spaces for Markdown, JSON, and YAML; LF; final newline; no trailing whitespace.
- Biome is the formatter and linter. Do not hand-format against it or weaken rules to make a change pass.
- Keep extension-facing `index.ts` files thin. Re-export a small public surface and delegate installation or behavior to a cohesive owner.
- Split modules at a production consumer, test seam, or one-way dependency boundary—not merely because a file is long.
- Keep state machines cohesive when splitting would hide lifecycle ownership. Existing complexity suppressions should name the specific cohesive boundary they protect.
- Use Typebox for Pi tool schemas and keep runtime validation aligned with the declared schema.
- Preserve structured cancellation and error visibility. Do not turn failures into success-shaped defaults or broad catches.
- Add comments for durable, non-obvious constraints (trust boundaries, lifecycle ordering, protocol shape), not to narrate a diff.
- Keep tests next to component ownership; use root `tests/` for package and cross-component seams.
- Prefer behavioral tests over duplicated hard-coded inventories. Fixtures must exercise production consumers, not mirror documentation.

## Configuration, trust, and state

Several features read global Pi configuration and optionally trusted project-local configuration. Model profiles are the deliberate exception: provider/model/thinking policy is read only from user-global `model-profiles.json`; projects and agent definitions may reference profile names but cannot redefine their mappings. Other trusted project settings may override global settings; untrusted project content must not silently become model/system-prompt authority.

Preserve these categories:

- **Package configuration** — tracked manifest and docs in this repository.
- **User/project Pi configuration** — user-global model profiles plus settings, MCP, subagent definitions, and optional pair guidance resolved at runtime with their documented trust boundaries.
- **Session state** — Pi session JSONL, including context and Pair memory entries.
- **Task workbench state** — `.ledger`, governed by repository-owner storage policy.
- **Temporary worker state** — bounded files/processes that must be cleaned up on success, failure, cancellation, and shutdown.

Never move credentials, private transcript content, or memory records into repository fixtures, logs, package contents, or third-party calls. Tests should redirect runtime state to temporary directories rather than touching a developer's real Pi configuration.

## Change playbooks

### Adding or changing an extension surface

1. Identify the owning component and keep registration thin.
2. Add or update the extension entrypoint.
3. Update the manifest's Pi extension list and published files if necessary.
4. Test domain behavior directly.
5. Update the package-load smoke test for an intentional public tool/command/hook change.
6. Run typecheck, the relevant suites, loader test, and package dry run.

### Changing compaction or recall

1. Trace both `session_search` and Pair memory consumers before editing.
2. Preserve the single-cut/single-hook model and shared metadata recognition.
3. Test cut selection, projection/folding, continuation behavior, and both recall paths as applicable.
4. Include reload/compaction lifecycle cases when asynchronous state changes.

### Changing exec or agent behavior

1. Decide whether the behavior belongs to interactive collaboration, program composition, or the shared type/model-routing layer.
2. Verify root, child-session, and disposable-worker behavior separately.
3. Preserve tool scope, serialization, budgeting, cancellation, trace recovery, usage accounting, and cleanup.
4. Test both success and the relevant failure boundary; use integration tests when subprocess or extension capture is involved.

### Adding or changing a skill

1. Keep the trigger precise so the skill is not loaded for unrelated work.
2. Put reusable long examples or role prompts in that skill's `references/` directory.
3. Keep runtime code in production modules; skills instruct agents but are not hidden application state.
4. Verify package inclusion and any loader/integration invariant that depends on the skill.

### Importing third-party work

1. Adopt behavior intentionally rather than copying an entire upstream architecture.
2. Keep one local implementation of each responsibility.
3. Record source and license provenance.
4. Update `docs/boundaries.md` only when the durable architectural decision changes. Update the README catalog only when the public surface changes.

## Documentation discipline

Do not expand this file with every command, tool parameter, configuration key, or file. Those details already have better owners. Update `AGENTS.md` only when a future agent's high-level mental model, change-routing decision, or safety boundary would otherwise be wrong.

When behavior changes, update the closest authority:

- Exact user workflow or feature contract: the relevant `docs/` page.
- Human catalog and install path: `README.md`.
- Maintainer/module convention: `docs/development.md`.
- Ledger semantics: `docs/ledger.md` and the injected ledger prompt source together.
- Machine-discovered surface: manifest and executable loader tests.
- Third-party ownership/provenance: `THIRD_PARTY_NOTICES.md`.

Before finishing, report what changed, the checks actually run and their outcomes, any pre-existing failures, and what remains unverified. Do not claim a clean full suite when only a narrower command ran.
