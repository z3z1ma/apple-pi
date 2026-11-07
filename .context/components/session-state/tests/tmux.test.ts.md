## file

`TMUX_TMPDIR` holds the scratch `-L` servers, so the runtime sees only those and never the operator's. The path tmux was asked for, through macOS's `/var` alias, is not the resolved path the runtime keys servers by.
Why: a test that uses the operator's tmux server would attach to his sessions, and an alias path would miss the row the runtime stored.

For dead-pane removal controls, set the scratch server's default shell explicitly and wait until tmux reports `pane_dead=1` before invoking removal. Exercise live and respawned controls separately.
Why: launching a short command and sleeping briefly left the pane alive in an isolated probe, so a successful conditional command did not prove its dead-pane branch ran.
Queued cases use an in-process real Runtime, real SQLite, public socket hellos and disposable pane processes. Earlier-window gating checks fresh selection; pending-shared gates this target before the primitive, proving pre-aborted suppression. Inflight cases hold only the isolated server stopped while the actual primitive is running, then change logical ownership/name. Verify ownership AbortError rather than timeout, and that the exact socket's client is gone before resuming. Cancellation does not guarantee undo: the strengthened real-server controls still applied buffered writes after client exit. The operator accepted that residual; only inflight disconnect/shared cases allow either original or captured-person label. Rename/switch still require eventual current naming. Unrelated labels and the physical-target primitive stay strict.

Check next topology observations and rename-hook history where suppression is guaranteed; wait further polls for the residual/convergence cases. The worker constructor supplies runtime-main's source loader while keeping workers real and preserving workerData; assigning process.execArgv alone did not do so.
Why: physical composition does not detect a new logical owner in an existing pane, and simple cancellation controls passed schedules that stronger controls disproved. The finite physical model and asynchronous-exit countermodel have explicit limits; neither represents native Pi /reload.
Coupled: components/session-state/src/tmux.ts, components/session-state/src/runtime.ts, components/session-state/tests/helpers.ts
Verify: components/session-state/tests/tmux.test.ts
