# 03: Add managed tasks to active-work surfaces

**What to build:** Make scheduled prompts, scheduled commands, background commands, and monitors visible as live managed work without requiring a tool call. Add a terse active-task count to the editor metadata and integrate task rows into the same above-editor active-work presentation used by subagents, while preserving task notifications as the record of terminal outcomes.

**Blocked by:** 01: Move subagent activity above the editor

**Status:** done

- [x] Creating a scheduled, due, or running managed task immediately adds it to the above-editor active-work surface and updates that surface when its lifecycle state changes.
- [x] The input card shows `tasks:N` for all scheduled, due, and running managed tasks, hides it when the count is zero, and displays coherent non-zero agent and task counts when both domains are active.
- [x] Task rows clearly distinguish prompts, commands, and monitors and show the most useful bounded state for each kind, including due/running timing and monitor event-delivery state where applicable.
- [x] Mixed agent and task activity forms one visually coherent, width-bounded above-editor presentation with predictable overflow behavior and no content below the editor.
- [x] Completed, failed, delivered, or cancelled tasks leave the passive surface and active count while their existing transcript notification or delivered prompt remains available.
- [x] Task creation, due delivery, monitor events, cancellation, process settlement, session navigation, shutdown, theme changes, and non-TUI execution produce timely updates without stale rows, counts, listeners, or timers.
- [x] User documentation and behavioral tests define the active-count semantics and the passive information shown for every managed-task kind.
