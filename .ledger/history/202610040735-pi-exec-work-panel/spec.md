## Problem Statement

The operator can use Ctrl+W to inspect public subagents and managed tasks, but cannot use that surface to understand an in-flight Pi Exec program. A program can coordinate tools and multiple model workers for a long time. Its purpose, outstanding calls, queued work, worker activity, and failures form one unit of work that neither existing tab represents.

Pi Exec already exposes a short live activity widget and tool-result details. Those surfaces do not provide focused inspection of the program and its workers. In particular, worker tool traces currently become available to the program only when the worker finishes.

## Solution

Add a **Pi Exec** tab to the existing shared work panel. Present the program first, with the host calls and model workers it owns beneath it. The operator can understand the program's objective, inspect outstanding work and live worker tool detail, see failures, and inspect its result after settlement.

Include both direct `pi_exec` calls and saved `program_*` executions. Integrate active Pi Exec programs into the existing shared passive active-work surface instead of maintaining a separate Pi Exec widget alongside it.

This is an inspection-first feature. It preserves execution ownership and semantics; it is neither another agent manager nor a debugger.

Terms used below:

- **Program invocation:** one execution of a Python snippet through `pi_exec`, or of a saved script through a `program_*` tool.
- **Host call:** an operation the script asks the harness to perform, such as a file read, shell command, HTTP request, or model-worker run.
- **Model worker:** a child Pi process invoked by the script to return a result to that script. It is not a public, independently resumable subagent.
- **Settled:** execution has ended successfully, failed, been aborted, or timed out; settlement alone does not mean success.
- **Passive active-work surface:** the shared status widget above the input editor. It shows activity without opening or focusing the work panel.

## User Stories

1. As an operator, I want a Pi Exec tab in Ctrl+W, so that I can inspect composed work in the same place as other active work.
2. As an operator, I want `/work` and Ctrl+W to use the same panel, so that Pi Exec visibility does not introduce a second management overlay.
3. As an operator, I want to switch between Agents, Tasks, and Pi Exec, so that each distinct kind of work remains easy to understand.
4. As an operator, I want opening the panel to leave input in the main editor, so that I can keep communicating with the main agent.
5. As an operator, I want the existing focus and close controls to apply to the Pi Exec tab, so that inspecting a program uses the established interaction model.
6. As an operator, I want the tab to remain usable on wide and narrow terminals, so that terminal size does not hide in-flight programs.
7. As an operator, I want resizing and tab switching to preserve my selected detail and scroll position, so that live updates do not disrupt inspection.
8. As an operator, I want reopening Ctrl+W to restore the last-used tab and selected record, so that I can return to the work I was inspecting.
9. As an operator, I want to see the program's display name and supplied objective, so that I can understand what the script is trying to accomplish.
10. As an operator, I want to inspect the program source, so that I can understand the composition beyond its short display label.
11. As an operator, I want saved programs to appear in the same tab, so that their work is visible without remembering which tool invocation started it.
12. As an operator, I want to see the program's elapsed time and execution state, so that I can distinguish active work from a settled outcome.
13. As an operator, I want calls grouped under their owning program, so that I can understand the relationship between the script and its work.
14. As an operator, I want to distinguish queued calls from running calls, so that waiting for concurrency capacity is not mistaken for execution.
15. As an operator, I want completed and failed call counts alongside outstanding work, so that I can understand observed progress without an invented percentage.
16. As an operator, I want to inspect a call's identity, relevant target, activity, and elapsed time, so that I can see what the program is waiting on.
17. As an operator, I want model workers identified by their supplied names and tasks, so that parallel workers are distinguishable.
18. As an operator, I want to see whether a worker is thinking or using tools, so that a running worker is more informative than a generic spinner.
19. As an operator, I want to inspect a worker's active tools before it finishes, so that I can understand long-running worker activity while it matters.
20. As an operator, I want worker tool outcomes to remain associated with that worker and program, so that parallel activity is not mixed into an unrelated roster.
21. As an operator, I want call and worker failures to remain visible when the script handles them and continues, so that a successful outer result does not conceal an unsuccessful part.
22. As an operator, I want to distinguish successful, failed, aborted, and timed-out program outcomes, so that settlement is not mistaken for success.
23. As an operator, I want settled program results and traces to remain inspectable in the current session, so that completion does not remove the evidence I was reading.
24. As an operator, I want passive Pi Exec activity alongside agents and managed tasks, so that one glanceable surface tells me what is active.
25. As an operator, I want settled programs to leave the passive active-work surface, so that it continues to mean work in flight.
26. As an operator, I want Pi Exec workers to remain separate from public subagents, so that inspection does not imply they can be resumed or steered independently.
27. As an operator, I want session and branch changes to clear stale inspection state, so that work from another context is not presented as current.
28. As an operator, I want inspection to preserve existing trace redaction boundaries, so that the new view does not expose payloads deliberately omitted from execution traces.
29. As an operator, I want the panel to report observed activity rather than claim an executing Python line or a diagnosed stall, so that the display remains trustworthy.

## Implementation Decisions

- **One shared panel:** register a Pi Exec section through the work panel's existing domain-owned section contract. The shared manager continues to own mounting, responsive placement, focus, tab switching, closing, and restored tab/record selection. Pi Exec owns its detail presentation and inspection state.
- **Program-first ownership:** a program invocation is the top-level inspection record. Its host calls are subordinate records; a model worker's tool operations are subordinate to that worker. Pi Exec workers remain distinct from public subagents and managed tasks.
- **Reuse execution state:** expose the current activity and operation state to the Pi Exec section instead of reconstructing it from rendered tool text or persisted partial results. Use the existing outer tool-call identity to correlate the invocation and its updates.
- **Bounded ownership, not a new runtime:** Pi Exec currently allows only one active program per extension session. Preserve that constraint. The inspection feature adds no scheduler, detached execution mode, generic operation manager, or new worker runtime.
- **Direct and saved execution:** both direct snippets and saved programs use the same execution and inspection lifecycle. Saved programs retain their existing supplied name and description.
- **Program detail:** expose the display name, supplied objective, inspectable source, elapsed time, observed execution state, call counts, outstanding calls, errors, and settled result/trace. An absent objective does not require invented explanatory text.
- **Call detail:** distinguish queued, running, succeeded, failed, aborted, and timed-out states. Expose the relevant target and existing activity/result/error summaries, with timing sufficient to understand outstanding calls. Queued time and running activity must not be confused.
- **Live worker detail:** extend the existing worker event decoding and tool-call correlation to make active child tools and their outcomes observable before worker completion. Preserve the relationship to the parent host call. A final-only nested trace is insufficient for this requirement.
- **Observed progress:** counts describe issued calls and their current outcomes. The program can discover further work through loops or dependent calls; issued-call counts are not a forecast of the eventual total. No percentage-complete estimate is required.
- **Failures remain evidence:** a caught host-call error or a failed status record returned to the script remains inspectable even when the outer program succeeds. Outer execution outcome and subordinate failures are distinct facts.
- **Session-local inspection:** retain settled invocation detail in memory for inspection during the current owning session/branch. Opening or closing the panel does not stop execution or discard its settled result. Session/branch lifecycle changes clear stale records and prevent late updates from repopulating the wrong context. Existing durable execution traces and Monty checkpoints remain authoritative for their respective responsibilities; add no second durable history store.
- **Shared passive activity:** publish active Pi Exec programs into the existing shared active-work renderer and remove the separate Pi Exec activity widget. Represent the program as the unit of active work rather than counting each of its workers as a public agent. Settled programs leave passive activity but remain available for focused inspection.
- **Interaction consistency:** preserve the existing non-capturing panel, responsive placement, keyboard focus transfer, mouse inspection, and state preservation described in the [work-panel contract](../../docs/subagents.md#work-panel). Provide keyboard access to Pi Exec detail and scrolling, as well as the established fullscreen mouse behavior. Exact internal navigation bindings and visual row layout remain implementation details.
- **Inspection changes no execution semantics:** retain existing call/concurrency budgets, worker ownership, cancellation propagation, result reduction, usage accounting, and checkpoint behavior. No new cancellation or steering action is included in this first version.
- **Existing disclosure boundaries:** reuse trace summaries and their existing redaction rules for call and worker detail. Rendering nested work is not authority to reveal bound context, schema payloads, credential-bearing HTTP fields, or other data deliberately omitted from those summaries.

## Testing Decisions

Good tests assert observable behavior: what the operator can inspect while execution is active and after it settles, which program owns the displayed work, and whether panel interaction preserves input and inspection state. They should not require a particular registry implementation, private state layout, or duplicated event inventory.

The operator confirmed both seams below before this specification was written. A later TDD invocation requires its own fresh seam confirmation.

1. **Automated execution-to-panel integration.** Drive the real Pi Exec tool lifecycle with controlled host calls and worker events, and inspect the real shared panel through the existing fake-TUI harness. This is the main behavioral seam for the feature.
   - Show a program and its objective/source while a host call is still pending.
   - Distinguish calls waiting for a concurrency slot from calls running now.
   - Show worker-specific active child-tool detail before the worker returns; preserve parent/worker correlation during parallel execution.
   - Preserve caught call errors and failed worker status records independently of the outer outcome.
   - Exercise success, failure, abort, and timeout, with settled results/traces remaining inspectable and terminal programs leaving passive activity.
   - Exercise direct snippets and saved programs through the same tab.
   - Verify registration through the package's actual extension-loading order, so the Pi Exec tab is available in the supported package load sequence.
   - Verify tab switching, focus return, preserved editor input, resizing, selected detail, scrolling, and panel reopen behavior with the third tab present.
   - Verify session/branch cleanup and rejection of stale late updates.
   - Verify shared passive activity without a duplicate Pi Exec widget or worker entries in the public Agents roster.
   - Preserve existing trace disclosure and execution-result behavior.
   - Prior art: [work-manager integration tests](../../tests/work-manager.test.ts), [Pi Exec execution, worker, and rendering tests](../../components/pi-exec/tests/pi-exec.test.ts), [Pi Exec session lifecycle tests](../../components/pi-exec/tests/session.test.ts), and [saved-program tests](../../components/pi-exec/tests/saved-programs.test.ts). These suites are precedent to extend, not a requirement to create one new test suite per module.
2. **Real fullscreen Pi through tmux.** Run an active Pi Exec script with worker activity and inspect it through Ctrl+W. Verify live worker tool detail before settlement, wide/narrow placement, tab switching, editor typing while the panel is open, explicit focus transfer and return, and continued inspection after settlement. This seam proves terminal behavior that fake-TUI tests cannot establish. Follow the [maintainer TUI validation procedure](../../docs/development.md#manual-tui-checks).

Run the relevant regression suites, typecheck, formatting/lint checks, package loader smoke test, and package dry run before declaring implementation complete. Package inclusion and loading checks supplement the two behavioral seams; they do not replace live inspection proof. Record which checks actually ran and distinguish automated proof from manual terminal proof.

## Out of Scope

- Implementation, ticket generation, commits, publication, or external issue creation as part of this specification step.
- New execution modes, concurrent top-level Pi Exec programs, schedulers, background program daemons, or a second agent runtime.
- Public-agent resume, steer, stop, or result-consumption controls for script-owned model workers.
- New program-level cancellation controls. Existing cancellation behavior remains unchanged.
- A full worker conversation viewer or a duplicate persistent worker transcript store.
- Python stepping, current-line reporting, variable inspection, breakpoints, or a general debugger/dashboard.
- Automatic stall diagnosis, arbitrary inactivity thresholds, or estimated percentage complete.
- Predicted future dependency graphs or calls the script has not yet issued.
- New command aliases, automatic panel opening, or a redesign of the existing Agents/Tasks tabs.
- Rehydrating the inspection roster after a process restart or creating a second durable execution history.
- Changes to Monty checkpoint semantics, tool permission boundaries, or host-call budgets.

## Further Notes

- This task follows the operator's request for Pi Exec visibility in Ctrl+W and carries forward the investigation's inspection-first recommendation. The operator subsequently authorized a new task destination and confirmed both test seams.
- The investigation established that the current activity snapshot is local to an invocation, includes queued/running host calls, and is used by the tool card and a separate above-editor widget. The worker decoder already receives child tool events, but only publishes coarse live activity outward; nested operations are attached to the parent after worker completion. These are starting facts, not requirements to preserve those limitations.
- [Pi Exec](../../docs/exec.md) owns the existing composition, worker, trace, cancellation, saved-program, and checkpoint contracts. [Subagents](../../docs/subagents.md) owns the existing work-panel interactions and the distinction between public delegation and program-owned model workers.
- [Adopted boundaries](../../docs/boundaries.md) require one active-work surface and manager with domain-owned detail, rather than a generic operation model or a full dashboard. [Development conventions](../../docs/development.md) govern module ownership and validation.
- The existing [responsive-work-panel task](../202610030836-responsive-work-panel/task.md) owns the already-implemented Agents/Tasks panel and its remaining acceptance work. This task adds Pi Exec visibility; it does not absorb or close that task.
- The [wiki domain language](../../.wiki/pages/domain-language.md) supports the distinction between public subagents and Pi Exec model workers. It is supporting vocabulary rather than a replacement for repository product contracts. The older wiki TUI design describes superseded entry/placement behavior; use the current work-panel documentation and responsive-panel design instead.
