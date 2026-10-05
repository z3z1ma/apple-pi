# 01: Inspect program invocations and host calls

**What to build:** Add a program-first Pi Exec tab to the shared Ctrl+W work panel. Let the operator inspect an active direct snippet or saved program, understand its outstanding host calls, and read its result and trace after settlement. Include the invocation-state exposure and registration needed for this usable slice; retain the current separate passive widget until [ticket 03](03-shared-passive-activity.md) replaces it. Follow the parent [specification](../spec.md), including its inspection-only scope and confirmed automated execution-to-panel and real fullscreen Pi test seams. Before writing or editing tests, obtain fresh confirmation of those seams for this implementation.

**Blocked by:** None (can start immediately).

**Status:** done

**Completion:** `9de7433`. Closed by operator request; the task outcome records validation results and the unresolved full-suite cancellation-test failure.

- [x] Loading the package through its supported extension sequence exposes a Pi Exec tab in the existing Ctrl+W and `/work` panel. Repeated opening reuses that panel rather than creating another overlay, and an empty tab remains usable before any program has run.
- [x] While a direct snippet is waiting on a controlled host call, the operator can inspect its supplied display name and objective, source, active execution state, and advancing elapsed time. A saved `program_*` execution provides the same inspection with its saved-program name, description, and executed source.
- [x] With host-call demand above the chosen concurrency capacity, the tab distinguishes calls waiting for a slot from calls actually running. Selecting a call exposes its identity, relevant trace-safe target, activity, timing, and available result/error detail; program counts reflect observed states without claiming an eventual total or percentage complete.
- [x] A host-call failure caught by the script remains visible in that invocation's call detail even when the outer program succeeds. Successful, failed, aborted, and timed-out outer outcomes are distinguishable, and their available results, errors, and traces remain inspectable after execution stops and after closing/reopening the panel.
- [x] While inspecting Pi Exec, opening the panel preserves main-editor input; existing tab, focus-return, close, keyboard inspection, and fullscreen mouse controls work. Switching tabs or resizing between wide and narrow placement preserves the selected detail and scroll position, and reopening restores the last-used tab and selected invocation.
- [x] After a session or branch change, the Pi Exec tab contains no records or selected detail from the previous context. Delayed activity or settlement from that old context does not repopulate the new view.
- [x] Automated execution-to-panel tests demonstrate the above behaviors while calls are still pending and after settlement, including trace-redacted detail and unchanged returned execution results. Relevant runtime/session/saved-program regressions, typecheck, formatting/lint, package loading, and package inclusion checks have recorded outcomes, with pre-existing failures identified separately.
- [x] A real fullscreen Pi check demonstrates Ctrl+W inspection of an active host-call script, wide/narrow placement, editor typing, focus transfer/return, and settled-result inspection. The Pi Exec and work-panel documentation explains the new tab and its inspection-only behavior; evidence distinguishes terminal proof from automated checks.
