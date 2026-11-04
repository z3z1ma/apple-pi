## file

Above-editor widgets are keyed as Pi keys them; a later mount replaces an earlier one. Role-aware registration can replace tool definitions during startup, so assertions read the settled tools. One shared surface carries both Pi Exec and managed-task work; Pi Exec mounts no widget of its own. A program is one unit of work independent of its peer count, and observed activity timing follows host-call progress.
Why: counting peers as separate work, or mounting a second widget, would hide the shared active-work contract.

This fixture loads the package's real Pi Exec entrypoint through Pi's extension loader. Its role installer runs in that same loader graph: a direct Vitest import can conceal the separate module-cache boundary and falsely authorize or reject peers. Preserve both managing/unroled-root execution and nonmanager refusal before any program scope or person is created.

The removed work-panel tests mixed rendering assertions with execution guarantees. This suite keeps native result/update traces, error-hook detail, per-peer child correlation, cancellation cleanup, late effects, bound-input redaction and shared passive activity. Native child references are pi.read/pi.grep/pi.bash; the old panel abbreviated those labels. Terminal trace children remain available even though live activity payloads intentionally omit child detail.

The bare extension runtime throws from `getActiveTools`/`setActiveTools` without a session, and the role installer calls them at session start, so the harness stubs both over a local list. Without the stub every peer case failed before any program ran (nine failures, already present at `fff4a416`).

Invoke the registered tool_result hook to inspect failed execution details: throwing is only one half of Pi's error-result path. Cleanup assertions in test bodies establish settlement; best-effort teardown only isolates tests.

Coupled: components/pi-exec/src/index.ts, components/pi-exec/src/active-work.ts, components/pi-exec/src/host-calls.ts, components/organization/src/session-role.ts, tests/fixtures/peer-pi.mjs
Verify: tests/pi-exec-integration.test.ts, components/pi-exec/tests/peer-calls.test.ts
