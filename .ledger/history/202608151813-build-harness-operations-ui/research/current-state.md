Status: done
Created: 2026-08-15
Updated: 2026-08-15

# Current harness and ledger UI state

## Question

What does a terminal user currently see during review and Ralph work, which reusable UI primitives already exist, and where can ledger tasks become the working-set interface without creating a second task database?

## Sources

- `components/review/src/index.ts`
- `components/review/src/controller.ts`
- `components/review/src/receipts.ts`
- `components/ralph/src/index.ts`
- `components/ralph/src/controller.ts`
- `components/ralph/src/receipts.ts`
- `components/ralph/src/task.ts`
- `components/subagents/src/ui/agent-widget.ts`
- `components/subagents/src/ui/fleet-list.ts`
- `components/subagents/src/ui/conversation-viewer.ts`
- `extensions/runtime.ts`
- `extensions/runtime-ui.ts`
- Installed Pi 0.84.2 documentation: `docs/tui.md` and `docs/extensions.md`
- `https://github.com/mitsuhiko/agent-stuff/blob/main/extensions/todos.ts`, accessed 2026-08-15

## Method

Read the command and model-tool entrypoints, controller stage transitions, active-run maps, receipt APIs, subagent UI components, Pi Exec activity renderer, Pi TUI extension documentation, and the referenced file-backed todo extension. Cross-checked the fresh read-only Explorer report against those sources.

## Findings

- Review installs a two-line above-editor widget before `ReviewController.run`, then leaves it unchanged through planning, grouped review, and verification. The controller has no progress subscription or callback boundary. Final state is shown only after the promise settles.
- Ralph likewise installs a two-line widget around `RalphController.run` or `step`; it does not expose executor, shared-review, judge, iteration, usage, or gate progress while work is live.
- Review and Ralph child agents are deliberately marked as internal owners and filtered from the public subagent widget and fleet. Making them public agents would violate the fresh internal-role boundary rather than solve observability.
- `AgentWidget`, `FleetList`, and `ConversationViewer` already provide bounded live rows, status text, keyboard navigation, scrollable overlays, live session subscriptions, stop confirmation, and steering patterns.
- `ExecActivityWidget` and `renderExecResult` already separate compact live activity from expanded tool details and use partial tool updates.
- Review and Ralph receipts already preserve durable stage, group, usage, finding, workspace, and terminal information. A UI projection can consume controller events and receipts without becoming authoritative state.
- The top-level ledger index is the task catalog and each `task.md` owns status. Ralph task mutations use digest compare-and-swap. An active-task feature should store only a session/branch-scoped pointer to a canonical task path.
- The referenced todo UI demonstrates fuzzy selection, assignment, detail overlays, quick actions, and session association, but its separate todo files and status database must not be copied because ledger tasks already own those responsibilities.

## Conclusion

Create explicit controller progress subscriptions and project them through dedicated review and Ralph UI modules. Add a ledger task picker and a session-scoped active-task pointer, while keeping the top-level ledger index, task records, and receipts authoritative. A task-local work-item representation may support subtask-style navigation, but its syntax, mutation authority, and relation to acceptance criteria require an explicit specification before implementation.

## Limits

No interactive TUI session was run in this investigation. Rendering and lifecycle findings come from source and current Pi API documentation. Exact keyboard interaction and narrow-terminal behavior remain to be tested during implementation.
