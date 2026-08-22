Status: active
Created: 2026-08-21
Updated: 2026-08-21

# First-class to-do implementation plan

## Goal

Deliver an apple-pi-owned active-execution checklist adapted from `tintinweb/pi-tasks` at `86a559cf5e378cc21fa0c7015a92c358e7227094`, while keeping backlog, to-dos, and Ledger as distinct authority layers.

## Fixed contracts

### Model and graph

- Statuses: `open | active | completed`; blocked is derived when an open to-do has an incomplete prerequisite.
- Store one `blockedBy` list and derive `blocks` to prevent inconsistent bidirectional edges.
- Reject dangling dependencies, self-edges, duplicate edges, cycles, and activation with unresolved blockers. Mutations are atomic and leave prior state unchanged on failure.
- Use monotonic numeric IDs, bounded text fields, timestamps, optional agent type/profile, managed-execution identity, bounded result, and last error.
- A managed execution is settled only when both to-do ID and run ID still match, preventing late workers from changing a newer branch or attempt. Shared-project execution identity also persists owner PID, process-instance UUID, and claim time.

### Persistence and configuration

- Default session storage appends complete snapshots under custom entry `apple-pi.todos-state` and restores the newest valid snapshot from `sessionManager.getBranch()` on `session_start` and `session_tree`.
- Opt-in project storage uses `<cwd>/.pi/todos/shared.json` with re-read-under-lock mutation, unique same-directory temporary files, atomic rename, and token-checked stale-lock handling.
- Project storage requires a trusted project. Storage-mode changes apply at the next session start and never migrate lists implicitly.
- A shared active claim owned by another process is never cleared automatically. `/todos` exposes an explicit confirmed recover-to-open action only when a recheck under the project lock finds the same run ID and its persisted owner PID is no longer live; recovery fails closed when liveness cannot be established.
- Data-only global defaults live at the Pi agent directory's `todos.json`; trusted project overrides live at `<cwd>/.pi/todos.json`.
- Retained options: `storage`, `autoCascade`, `autoClearCompleted`, `reminders`, `sortOrder`, `collapseCompleted`, and `maxVisible`. Auto-clear never mutates shared project lists.

### Public surface

Expose only lowercase native tools: `todo_create`, `todo_list`, `todo_get`, `todo_update`, `todo_delete`, `todo_execute`, `todo_output`, and `todo_stop`. Use `/todos` for the complete human manager. Do not add `Task*` aliases.

### Owned subagent integration

Extend the existing managed subagent service with a catalog-level background start method that resolves enabled agent type, profile, model, settings, Advisor policy, tool scope, queueing, persistence, and lifecycle inside the owning subagent extension. To-do agents are normal public `AgentRecord`s visible in FleetView and `/agents`, not internal controller workers. The service returns one ID and settlement promise and supports stop through the same `AgentManager`; no external RPC, duplicate runtime, transcript, or process tracker.

### Layer transitions

- Backlog → to-do: create first, then `backlog_take` after success.
- Backlog → Ledger: existing agreement → `ledger_add` → `backlog_take` flow.
- To-do → Ledger: explicit agreement → `ledger_add` → delete the original only after success, unless it remains an unambiguous execution step under Ledger authority.
- Ledger work may use to-dos as an ephemeral checklist; to-do completion is not Ledger acceptance evidence.

## Work Items

### WI-001: Safe state, persistence, CRUD, and package loading
State: complete
Dependencies: None
Review: staged — branch restoration and concurrent project mutation are costly to repair after release.
Files:
- Create: `components/todos/src/{types,state,repository,config,controller,installer,index}.ts`
- Create: `components/todos/tests/{state,repository,config,extension}.test.ts`
- Create: `extensions/todos.ts`
- Modify: `package.json`, `tsconfig.json`, `vitest.config.ts`, `tests/package-load.mjs`
Checks:
- `npx vitest run components/todos/tests/state.test.ts components/todos/tests/repository.test.ts components/todos/tests/config.test.ts components/todos/tests/extension.test.ts`
- `npm run typecheck`
Steps:
1. Implement pure model validation, CRUD, graph projection, dependency safety, and conditional execution mutations.
2. Implement branch-snapshot and file-locked project repositories with monotonic IDs and atomic writes.
3. Implement sanitized global/trusted-project configuration.
4. Build the controller around one selected repository, generation-safe branch restoration, and orphaned-run recovery.
5. Register native CRUD tools and package/test inclusion surfaces.

### WI-002: Widget, human manager, reminders, and lifecycle UX
State: complete
Dependencies: WI-001
Files:
- Create: `components/todos/src/{auto-clear,reminder-cadence}.ts`
- Create: `components/todos/src/ui/{todo-widget,todo-manager,settings-menu}.ts`
- Create corresponding component tests.
- Modify: to-do controller/installer and status-footer known-status ordering/tests.
Checks:
- Focused to-do UI/lifecycle tests and status-footer tests.
Steps:
1. Adapt the width-safe above-editor widget with counts, completed strikethrough, blocked rows, manual active state, and managed active spinner/metrics.
2. Publish `todos N` unfinished count through the input card.
3. Implement `/todos` create/edit/start/reopen/complete/blocker/execute/output/stop/delete/clear/settings flows using existing focus and confirmation conventions.
4. Port transient sanitized reminders and turn-based session-only auto-clear.

### WI-003: Owned subagent execution and safe cascade
State: complete
Dependencies: WI-001, WI-002
Review: one-pass — verify one runtime/record, race-safe settlement, and lifecycle cleanup.
Files:
- Modify: `components/subagents/src/service.ts`, `components/subagents/src/installer.ts`, relevant subagent tests.
- Create: `components/todos/src/execution.ts` and execution/cascade tests.
- Modify: to-do controller/installer/widget.
Checks:
- Focused to-do execution/cascade tests and subagent service E2E tests.
Steps:
1. Add a catalog-level background start service using the existing `AgentManager` and public `AgentRecord` visibility.
2. Atomically claim before launch; reset on launch failure; conditionally settle by run ID; abort locally owned runs on branch/switch/shutdown.
3. Implement execute/output/stop tools and matching human actions.
4. Build child prompts from the to-do plus bounded prerequisite results and optional context.
5. Auto-cascade only successful, fully unblocked, agent-backed dependents through the same atomic claim path.

### WI-004: Authority docs, provenance, and full release validation
State: complete
Dependencies: WI-001, WI-002, WI-003
Files:
- Create: `docs/todos.md`
- Modify: `README.md`, `AGENTS.md`, relevant backlog/Ledger/boundaries/subagents/status docs, workflow prompt/tests, `THIRD_PARTY_NOTICES.md`, package loader.
Checks:
- `npm run format:check`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run pack:check` plus inspection for the new extension/source/docs/notice.
Steps:
1. Document tools, statuses, graph rules, manager/widget, reminders, configuration, trust, storage, execution, and transitions.
2. Teach the root workflow the three-layer ownership and ordered promotion rules without loading to-dos into child sessions.
3. Record exact MIT provenance, adopted behavior, and rejected compatibility/runtime paths.
4. Run the full proof sequence and reconcile acceptance criteria.

## Explicit pruning from the reference

Do not copy the unwired process tracker; external subagent RPC or standalone fallback; Claude-compatible tool names; memory/named/arbitrary-path storage; per-session sidecar files; arbitrary metadata; independently persisted `blocks`; custom comparator configuration; external-agent reattachment; or reference media. Retain and adapt monotonic state, atomic project writes, safe locking, reminder/auto-clear state machines, width-safe widget concepts, data-only settings, dependency display/cleanup, cascade gating, and bounded prerequisite-result injection.

## Primary risks

1. Late asynchronous settlement after branch navigation.
2. Double execution from shared project races.
3. Corrupt or invalid graphs becoming executable authority.
4. Isolated extension module graphs bypassing the owned subagent service boundary.
5. Duplicate progress/transcript state instead of one `AgentRecord`.
6. Unsafe stale-run recovery in shared project mode; owner liveness and run identity must be rechecked under lock.
7. Unbounded session snapshots from stored results.
