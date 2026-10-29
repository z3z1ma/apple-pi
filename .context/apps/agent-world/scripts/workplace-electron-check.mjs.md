## file

Keep the check's `PI_CODING_AGENT_DIR` isolated before Electron starts, and close its application before removing that directory, including failed-launch paths. Find the checkout by walking upward rather than counting parents.
Why: Electron's single-instance lock is scoped by its userData path; a shared directory can focus the operator's existing window instead of testing this build. Checkout discovery follows the built app marker, so running from another working directory keeps the same isolation and entry check. Cleanup must cover launch failures as well as assertion failures.

The test window stays hidden with background throttling disabled and a distinct native title; its HOME is also isolated. Wait for the connected workplace surface to lose its inert attribute before entering Code.
Why: the disconnected surface deliberately ignores interaction even when its inputs are visible. A hidden connected window can exercise the application without inviting operator input or throttling the fixture's renderer.

The real runtime fixture uses an isolated socket and a transparent forwarding socket to observe actual Electron requests. It admits only this script's stand-in identities and places a failing fake Pi executable first on PATH; malformed/preflight-blocked IPC checks must create no start command. Runtime teardown waits for its owned child process before deleting scratch state.

A rendered profile must load its Self (the person's autobiographical document) without read_entry/read_entries, mark_seen or thread_read requests.
Why: unchanged database cursors alone cannot prove that no transcript was requested; the forwarding socket records the requests themselves.

Keep the bare-start Workplace/Chat assertion and Chat/Mail checks. The World rail button selects ?workplace=world and opens the Agent World iframe; return through the shared Chat rail. Main-document markers survive ordinary rail switches, and a child-document marker survives hiding and revisiting World. A separate real anchor from Chat to ?workplace=org must replace the main document. Standalone ?world is not the ordinary World-tab entry.
Why: a URL change alone cannot distinguish history replacement from document replacement. Retained markers establish tab lifetime; the real anchor and cleared marker separately exercise Electron's will-navigate allow-list. Keeping the anchor's destination different from the current Chat URL preserves an actual cross-route navigation check.

Progress events and invoke replies travel asynchronously through Electron. Wait for the subscribed progress event separately before disposing its listener; a resolved orgStart promise alone does not mean the renderer has dispatched world:org-progress.
Why: the first actual-host run missed a valid progress event by disposing the listener as soon as the invocation resolved. Both channels must be observed independently.

Run this script against a completed Agent World build while the shared browser/Electron validation slot is free. It reads committed build output, not renderer source; a later build needs a new run. Capture paths are logged absolute because macOS Node tmpdir is not necessarily /tmp.
Coupled: apps/agent-world/src/electron/main.ts, apps/agent-world/src/electron/preload.ts, apps/agent-world/src/backend/org.ts, apps/agent-world/web/workplace-org-chart.tsx, apps/agent-world/web/workplace.tsx, apps/agent-world/web/workplace-world.tsx
Verify: apps/agent-world/scripts/workplace-electron-check.mjs
