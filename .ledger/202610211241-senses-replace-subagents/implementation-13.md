# Implementation 13: the workplace in Agent World

## Approach

The runtime remains the only writer of threads and assignments. The backend reads summaries for the snapshot, and reads a goal or conversation when the operator opens it. Ledger discovery stays read-only and scoped to the organization's directories, as the native directory's backlog is. It shares the existing task-file reader and periodic reread cadence.

The existing messenger birds already carry letters. A separate meeting room off each headquarters' gallery reuses the common-room painting; open meeting membership places awake participants there, with the most recent conversation winning when meetings overlap. Closing the meeting restores ordinary placement. The operator still chooses where to walk.

Headquarters' painted notice boards show ledger work and backlog, with the existing notepad still accessible. Team boards show their channel and pinned ephemeral notes. Focused work is carried visibly; picking up a task is only a UI selection, and handing it to a person sends the runtime's ordinary assignment command as the operator. The world changes ownership only from subsequent runtime facts.

Escalations remain mail, as specified. The native escalation tool's `Escalation` subject and an unread operator participant identify the request. The headquarters desk gains the operator's letter tray and a place to approach; reading the thread clears its attention through the existing inbox path. No new thread kind, meeting scheduler, assignment store, or model action is introduced.

Every new object and action gets words in all three theme packs. Existing room geometry, paper art, doors, walking, and panel patterns are reused.

## Backend slice

The snapshot now carries open meetings, active team-channel summaries, live task assignments and focus, backlog, and unread operator escalations. Bodies are read on demand. The three backend actions (`readTask`, `assignTask`, `readWorkplaceThread`) are wired through Electron's typed bridge. A shared-board read does not join the operator or advance another participant's cursor; private mail retains its participant-only reader.

A disposal regression was found while connecting the workplace to the incremental reader: a deleted temporary peer stayed cached at the inn, and a sleeping lasting report kept its old manager. The production cleanup transaction now emits named events for both changes, and the backend evicts event-named ids with no remaining root row. The regression failed before the fix (`/tmp/apc13-disposal-red.log`) and passed afterward. Native cleanup already closes a discarded organizer's meetings; no extra meeting lifecycle was needed.

The backend test also caught a bad fixture: `fakeBridge` takes `reportsTo` in `facts`, not `session`. The corrected fixture asserts the stored reporting line before checking organization-scoped discovery.

Two boundary checks also failed first, then passed. A file's `Status: done` had hidden a still-held assignment; the reader now preserves it until the runtime ends ownership (`/tmp/apc13-assigned-done-red.log`, `/tmp/apc13-assigned-done-green.log`). Giving work as `operator` to a sleeper saved the assignment but could never wake it, because the operator has no incarnation or pane. The UI now supplies its attached terminal through the existing wake-pane lookup, and the runtime uses that target for operator assignments (`/tmp/apc13-operator-wake-red.log`, `/tmp/apc13-operator-wake-green.log`). Other assigning sessions continue to use their own panes.

The physical objects and their panels are next; this backend slice does not mark ticket 13 done.

## Verification

The backend slice passed 34 tests across five suites, including native program cleanup and the existing World backend and operator inbox (`/tmp/apc13-backend-final.log`). After adding the cross-organization assignment rejection and orphan-directory checks, the workplace, disposal, and build suites passed again (five tests, `/tmp/apc13-backend-build-test.log`). Node/web typecheck and the World build passed (`/tmp/apc13-backend-types-final.log`, `/tmp/apc13-backend-build.log`).

The later operator-wake check passed 18 tests across the inn, recruit, workplace, and native work suites (`/tmp/apc13-operator-wake-green.log`). The final foundation build, build-freshness test, and Node/web typecheck passed (`/tmp/apc13-foundation-{build,built,types}.log`); scoped Biome, context lint, and diff checks passed too.

Next prove the visible interactions in headless Chrome, inspect screenshots, and rebuild the World output again. Full repository validation belongs to ticket 14. No live operator runtime or session is changed.
