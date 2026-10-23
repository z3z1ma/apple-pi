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

The remaining physical objects and panels are next; neither slice marks ticket 13 done.

## Verification

The backend slice passed 34 tests across five suites, including native program cleanup and the existing World backend and operator inbox (`/tmp/apc13-backend-final.log`). After adding the cross-organization assignment rejection and orphan-directory checks, the workplace, disposal, and build suites passed again (five tests, `/tmp/apc13-backend-build-test.log`). Node/web typecheck and the World build passed (`/tmp/apc13-backend-types-final.log`, `/tmp/apc13-backend-build.log`).

The later operator-wake check passed 18 tests across the inn, recruit, workplace, and native work suites (`/tmp/apc13-operator-wake-green.log`). The final foundation build, build-freshness test, and Node/web typecheck passed (`/tmp/apc13-foundation-{build,built,types}.log`); scoped Biome, context lint, and diff checks passed too.

### Meeting-room slice

Open meetings now place awake participants in their organizer's meeting room; closing a meeting restores their home. Unread operator escalations take their authors to headquarters, and reading them restores home or the latest open meeting. This is a projection, not a change to the directory. Work keeps the headquarters board reachable when the organization sleeps.

Every headquarters has a meeting-room door after its wing doors. It uses the common-room painting with a gallery exit and without duplicated named crew. All three themes name the room. The native workplace and theme-pack checks passed (23 tests, `/tmp/apc13-room-model.log`); Node/web typecheck and build passed. The first three Chrome suites passed 23 tests, with three outdated place/banner inventories; those now include the room and all three passed on rerun (`/tmp/apc13-room-browser{,-green}.log`). The gallery and room screenshots were read from `/tmp/apc13-room-shots/`. The existing backend, disposal, and build checks also passed (21 tests, `/tmp/apc13-room-backend.log`), as did scoped Biome, diff checks, and context lint (133 files).

### Boards and handover slice

The headquarters notice board now opens a task board (assigned work, backlog, notes) and the team board (channel posts, notes); a wing's banner opens the team board; the meeting-room door and anyone inside open the agenda. A goal reads from `task.md`, renders as safe Markdown, and can be carried; a carried goal adds a give action to every awake or sleeping person. Giving calls `assignTask`, which the backend suite proved reaches the runtime. All three packs name the new objects. Four Chrome tests passed with the notepad, build, and theme-pack suites (31 tests, `/tmp/apc13-desk-browser.log`); screenshots in `/tmp/apc13-desk-shots2/` show the board, team board, and meeting room in each theme. Existing mail-letter and quest-office tests cover the remaining criteria unchanged.

Two spec details remain unrendered: a character does not yet carry a visible quest token, and an escalation goes to headquarters rather than a specific operator desk. The operator should decide whether these need art before ticket 13 closes. Full repository validation belongs to ticket 14. No live operator runtime or session is changed.
