## file

This is a fixture-only rendered-UI check. Keep its backend messages and command receipts in memory, and emit a new snapshot object for each simulated run-state update. Keep the derived `facts.status` consistent with `facts.run` when simulating idle and working transitions. The real Electron navigation check is separate. Checkout discovery stops with an error at the filesystem root, as the Electron check does, rather than looping when this script is copied outside the checkout.
Why: `worldStore` exposes snapshots through `useSyncExternalStore`, which needs a changed snapshot reference to redraw. Immutable reply fixtures previously hid accepted posts, while direct-route browser checks could not reveal Electron's navigation guard blocking the launcher. A run-state-only fixture mutation can leave the summary status working and falsely fail the visible idle label. Passing this check proves neither real message delivery nor the Electron entry path.
The Joined disclosure has a public accessible label; drive it by that label instead of assuming the native summary's button role or its combined text with the caret. Channel Markdown includes deliberately hostile text probes: literal HTML, image alt text, and an inactive unsafe link are expected output, not rendering failures.

Unread screenshots contain an actual unread DM and a longer name. Their geometry check requires a positive-sized circle that fits the name line, rather than fixing its pixel diameter.
Why: earlier screenshots lacked the unread state, and a generic text flex rule later stretched that indicator; a particular diameter is a presentation choice, not the requested behavior.

After resizing the viewport, wait for two animation frames before taking a screenshot. Immediate captures showed duplicated bottom pixels although the DOM held one app at the correct height; the paint boundary removed that artifact at both widths. Distinguish stale compositor pixels from measured layout overflow, which the conversation regression checks separately.

Coupled: apps/agent-world/web/world-store.ts, apps/agent-world/scripts/workplace-electron-check.mjs
Verify: apps/agent-world/scripts/workplace-smoke.mjs
