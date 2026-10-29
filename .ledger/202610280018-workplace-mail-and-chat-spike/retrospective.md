# Retrospective

## Adoption

The operator adopted Workplace as a supported product surface on 2026-10-29 and authorized commits on main. Current behavior now belongs to `docs/workplace.md`, permanent UI modules and maintained app validation scripts; the snapshots and iteration records here remain historical evidence. World remains the default. Source/build, runtime participation and hire-date facts were committed as `62853bb2` and `5fd0f8aa`. Final focused validation passed 78 tests across 10 files without excluding retirement, combined typecheck, build freshness, fixture smoke, actual isolated Electron entry/profile IPC, scoped Biome and loader checks. Package inspection confirmed nine required product files and no stale workplace-spike assets. `adoption.md` records the evidence.

The Org follow-up moved to `.ledger/202610290925-org-chart-and-task-specific-teams/`. Its plan remains proposed; no reporting edits, team launches or whole-tree channels have been wired. Amos's cold read identified transition ambiguities: existing moves during partial startup, the exact handoff, late readiness and split-channel history. Clarifying these before mutation avoids mistaking agreement on a direction for approval of every operational policy.

The earlier sections below retain what was true at each evaluation point. Explicit adoption supersedes their temporary/pending-verdict instructions. Product promotion was not another validation hire, live message or daemon restart.

## Initial spike result

Built one working Gmail-like Mail surface and one Slack-like Chat surface inside Agent World's existing Electron window, reached through a temporary Workplace spike link. The World remains the default. Chat lists first-class team channels and agents as direct session conversations; sleeping agents have expandable history entries. The session view reuses the existing transcript, live streaming, tools, questionnaires, instructions, and receipts. Mail uses the existing operator inbox, thread reads, replies, and send-mail commands. There is no new runtime, database, message store, or backend write path.

The UI source snapshots and the small host integration patch are preserved under `prototype/`. The production-tree files are temporary evaluation wiring, not an adopted feature. Run and removal/evaluation guidance is in `README.md`. The operator's verdict is pending.

## Initial checks actually run

- `npm run typecheck`: passed, Node and web TypeScript.
- `npm run build:world`: passed, all three build targets.
- Focused Biome check on the five changed UI source files: passed with no remaining diagnostics.
- Fixture-only headless Chrome smoke: passed. It checks a busy agent's follow-up instruction, channel post and returned message, observer-only channel access, mail reply and returned message, composing mail, disconnected state, and absence of browser/console errors. Final screenshots: `/tmp/wp-spike-final-shots/{chat,channel,mail}.png`.
- Original UI regressions: four files, 33 tests passed, one worker: `world-conversation.test.ts`, `world-interface.test.ts`, `world-workplace.test.ts`, `build.test.ts`. The build test verifies that the current `dist/` matches a fresh build of the source; this working tree has not been committed.
- `context_lint`: passed, 196 context files.
- `git diff --check`: passed.
- No full suite was run, in line with the operator's shared-machine test policy. Packaging was not separately exercised; all source/build paths are inside the existing Agent World package allowlists.
- No live messages were sent and no real runtime was restarted for validation. Live Electron/runtime behavior remains for the operator to try.

## First-user findings and fixes

Amos Hargreaves ran the fixture check and inspected screenshots. The live-session versus shared-channel distinction and busy-session timing controls were understandable. His material confusions were addressed: unread badges now use the same unit (messages), channel receipts say Post, and Compose explicitly states the fixed-subject limit. His observation that the accepted channel post was absent exposed an immutable fixture, not evidence of a missing runtime post: the fixture now stores replies and asserts they reappear after reading the thread.

## What mattered

The existing ownership boundaries made this a shell rather than a backend project. Channel observation is intentionally different from participation, and mail is intentionally different from live session steering. An embedded conversation must not inherit the modal's keyboard trap, and a hidden conversation must stop observing so it cannot swallow unseen results. The alternate surface preserves those distinctions.

## Follow-up simplicity review

Kept the thin entry switch and shared session renderer rather than introducing a new routing or transcript abstraction. Found one lost behavior: the embedded layout hides the character sidebar, which also hid link-opening and mark-seen failure notices. Moved those existing notices into the shared main pane for both layouts, with no extra mode-specific error path. Extended the fixture smoke to click an unsupported link and require the failure notice to be visible.

Rebuilt the app and reran the fixture smoke, focused Biome check, and standalone web TypeScript check successfully. The subsequent combined `npm run typecheck` was blocked by a concurrent change outside this review's files: `apps/agent-world/src/electron/main.ts:233`, where a two-argument event listener disagreed with its declared one-argument callback type. This is separate from the earlier passing combined typecheck; the unrelated source was left intact. The same four focused regression files passed again (33 tests, one worker), and `context_lint` passed with 199 context files. No live runtime writes were used to check the change.

## Operator launch failure and final checks

The operator had to ask to open the spike, then reported that the launcher did nothing. The direct-route Chrome fixture had bypassed Electron's blanket `will-navigate` prevention. A real isolated Electron check reproduced the blocked click. The host now allows only the exact internal World and workplace URLs; all other navigation remains blocked. The same check then entered the spike and returned to World successfully. Agent World was reopened for the operator; no Pi sessions or runtime daemon were restarted.

The local Electron API declaration now includes the real navigation callback's URL argument. Combined `npm run typecheck` subsequently passed (one preceding invocation timed out). The final four-file regression run passed 33 tests with one worker.

This was a delivery failure as well as a missing check: open a requested spike when it is ready, and validate its actual entry path before handing it over. `electron-navigation.mjs` retains the real-host check.

## Remaining boundaries

Mail subjects remain fixed by the existing send API. Thread bodies use explicit Read latest; session replies stream through the existing protocol. Search is limited to snapshot subjects/delivery text. Draft bodies are in-memory. Mobile layouts and production accessibility/hardening were not the scope of this desktop spike. The initial invitation-only limit was superseded by the operator's third-iteration request for a real membership bridge.

## Third iteration: dark mode and explicit participation

Added remembered dark/light appearance, channel Markdown using the existing safe renderer, and a real operator Join/Leave command through the existing runtime. Membership persists as an invited pull participant; repeats preserve the cursor, and the runtime refuses private-thread and nonoperator requests. Recovery tests cover accepted commands across crashes. The renderer still never writes the database. More detail and verification evidence are in `iteration-3.md`.

The preview was reopened while final checks ran. Loading the new command required restarting the existing runtime daemon once, not the Pi sessions. Final build and combined typecheck passed; eight focused files passed 46 tests with one worker. Fixture smoke, real isolated Electron navigation, scoped Biome, context lint (201 files), and diff checks passed. No live messages were sent as validation, no full suite was run, and no commit was made.

Amos found the dark palette and membership controls understandable. Literal hostile Markdown probes caused visual uncertainty, but he confirmed they remained inert; the run notes now identify them. A failed smoke assumption about the Joined disclosure's combined text/role was resolved with a meaningful accessible label rather than a DOM-specific locator. The broader principle still holds: reuse a shared renderer's trust boundary, but give each surface clear controls for its own authority.

## Post-delivery test review

Separated appearance, channel Markdown, and channel participation into independently falsifiable browser tests; added direct compose-draft recipient/body retention coverage. Replaced global image absence and an inert script marker with visible escaped-HTML/alt-text checks scoped to the untrusted probe, and removed the smoke's header CSS-selector dependency. The production TSX and CSS needed no further changes. Combined typecheck, all 22 conversation tests with one worker, fixture smoke, scoped Biome, context lint (202 files), and diff checks passed. Current evidence and unchanged live-delivery/full-suite limits are recorded in `iteration-3.md`.

## Fourth iteration: text-only means text-only

The operator's screenshots clarified that retaining historical failure warnings, thoughts, and notifications was the wrong interpretation of tools off. The new view shows only assistant/user text while preserving full history for details on. The header stays short; current tool detail moves to a single-line lower indicator with width-based ellipsis and a full hover title. The composer outline is continuous after removing inherited gap/margins, and a zero-minimum grid track keeps nonwrapping actions inside the pane. Additional visual changes stay restrained.

Final build, combined typecheck, four focused files (39 tests, one worker), fixture smoke, isolated real Electron navigation, scoped Biome, context lint (202 files), and diff checks passed. The layout regression caught a real narrow-pane overflow during the polish pass; it was fixed at the grid track instead of weakening the check. A separate post-resize screenshot artifact disappeared after waiting for paint, without a product workaround. Detailed changes and evidence are in `iteration-4.md`. No daemon restart, live validation messages, full suite, or commit in this iteration.

## Fifth iteration: names and avatars have distinct jobs

The operator asked for DM navigation from names, profiles from avatars, and color variation. Reused sender IDs, the existing selection/history paths, and the World examine card's observed fact rows. The new profile owns no backend. Profile opening does not mark messages seen; Message enters the real DM. Dormant/former histories remain read-only and the operator is not guessed to be a Pi session. Actual avatar buttons replace decorative transcript pseudo-avatars, while World's labels remain unchanged.

Stable ID-derived muted hues agree across surfaces and appearance. Inspecting the first profile screenshots showed that full tool arguments did not belong in the profile's facts list; it now shares compact status and keeps detailed commands in the lower DM indicator. Focus restoration belongs to the caller's exact avatar trigger so replacing a profile cannot restore an older avatar. Text-only checks now prohibit diagnostic folds rather than all buttons, preserving the newly requested identity controls without relaxing detail filtering.

Final build/typecheck passed. Four focused files passed 43 tests with one worker; a final targeted check added retained former-member coverage. Fixture smoke, isolated real Electron entry/return, scoped Biome, context lint (203 files), and diff checks passed. The working build was made available before wider validation finished. Detailed evidence is in `iteration-5.md`. No runtime restart, live validation messages, full suite, or commit.

## Sixth iteration: better evidence, not invented history

The operator chose 200-character independent Record/Self previews, field-grouped full Self on demand, and explicit future hire-date recording together with an honest First seen fallback. The runtime seam stamps a successful new lasting hire with its applied start, without scanning or dating older hires. Unknown dates remain null; reconnects and moves preserve known dates. The profile has no conversation acknowledgment effect. Light questions gain contrast while the approved dark treatment stays unchanged.

Unread work reuses actual run-level session flags and operator thread cursors. A test disproved my old-cursor assumption because posting marks the sender read through its own post. New-message boundaries now use the returned pre-read cursor, with sequence gaps and own posts covered. Focus/current loaded history/latest position gate DM acknowledgment; channel readers preserve older positions and surface retryable failures. Chat counts unread conversations, channel rows count messages, and Mail no longer duplicates channel threads. Sent/Activity retain existing delivery ownership.

The operator's screenshot then exposed a visible defect despite passing behavior tests: the DM text's generic child-span flex rule stretched the unread dot to 81 by 7 pixels. Naming the text slot and scoping the indicator restored a fixed 7-by-7 circle. Tests now measure that rendered state in both themes, and the smoke saves representative unread screenshots. Previous screenshots had no unread DM, so they were not evidence of its appearance. I made the fixed build available and stated the reload requirement rather than claiming the already-open window had updated.

Combined typecheck/build passed; the final four UI/build files passed 47 tests with one worker. Seven focused data/UI/runtime files earlier passed 62 tests with one explicitly excluded existing retirement-contract mismatch; the isolated pre-hello window-close test passed separately. The fixture smoke and real Electron profile-bridge/entry checks passed. With approval, the replacement daemon loaded the date column, reconnected all six Pi processes with unchanged PIDs, and left old dates unset. No live validation hires/messages, full suite, or commit. Detailed evidence, limitations and the existing failure are in `iteration-6.md`.

## Maintainer test review after the sixth iteration

Moved hire-date coverage to the public backend snapshot boundary, including actual missing-column reads; removed participant-table assertions in favor of returned cursors, own-post sequences, unread totals and private-read refusal. Profile checks now assert the visible fields and independent expansion/collapse rather than a panel-wide region count. A held newest-page response tests the unread acknowledgment ordering directly. Readability and small-circle checks retain the requested appearance without locking a border width or dot diameter.

Selecting Mail's Activity folder exposed a stale Organization traffic destination heading that the old button-only test missed; corrected that label without changing delivery semantics. The focused run passed 55 tests with the existing retirement mismatch excluded; final targeted cases, smoke and real Electron entry/profile IPC passed. No live restart or validation messages. See the post-delivery review in `iteration-6.md` for scope and logs.
