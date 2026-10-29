# Sixth iteration: profile details and unread updates

## Operator choices

Keep the approved dark question colors; strengthen the light question signal. Preview Record and each Self field independently at 200 characters. Show full Self by field, fetched on demand. Record explicit hire dates for new successful hires, with a clearly labelled First seen fallback for unknown history. Improve unread behavior using existing state, and give Sent and the renamed Activity their own icons.

## Delivered behavior

- Light questions have a higher-contrast orange/cream bordered badge. The dark indicator keeps its exact approved color.
- Record and individual Self fields have independent See more/See less controls. Only the four rendered Self field headings start fields; headings inside their bodies remain in that field. Self is plain, inert text and is read through a new on-demand profile IPC, not added wholesale to snapshots. Profile observation still performs no conversation read or acknowledgment.
- `sessions.hired_at` is nullable and runtime-owned. A new lasting role-and-goal hire is dated when its first connecting start becomes applied, in the same transaction. Failed starts, old applied starts, ordinary hellos and program peers stay unknown. Reconnect, call-in, restart and moves retain stored dates. Hired and First seen are separate labels. Missing-column databases remain readable.
- Live DM unread updates have bold names and a small fixed circular dot. The Chat rail counts unread conversations, not fabricated DM message counts. Embedded DMs wait for a successful newest-page read for the current observed run state, focus, and the latest scroll position before acknowledging a result. Older reading positions stay put; new content offers Jump to latest and a New boundary.
- Channel counts use actual operator inbox summaries. A new-message divider uses the cursor captured before the read acknowledged its returned messages. Own posts advance the author's cursor; global sequence gaps mean `lastSeq - unread` cannot reconstruct it. Focused readers following the latest posts refresh automatically; older reading or an inactive window leaves later posts waiting. Failed automatic reads remain retryable without an automatic retry loop.
- Channel threads stay in Chat rather than being duplicated in the workplace Mail Inbox. Sent and Activity retain their delivery-record semantics and now have icons.
- Dormant profile adapters preserve the observed role title; their placeholder zero cost is omitted rather than presented as an observation.

## The oval regression

The operator's live screenshot caught a stretched unread indicator after the state tests passed. A generic `.wp-dm-link > span` flex rule matched both the text and the new dot. A rendered regression reproduced **81 by 7 pixels**. Only the named text-summary slot now grows; the DM dot is **7 by 7** in both themes, separately styled from Mail's dot. The redundant New update prefix was removed. The smoke now includes actual unread-state light/dark screenshots, including a longer name. This was a presentation defect, not a failure of unread-state storage.

## Verification actually run

- Combined Node/web TypeScript and the world build passed.
- Seven focused files passed **62 tests**, one worker, with one explicitly excluded pre-existing retirement test. These include real isolated runtime hire-date tests, backend/profile projection, operator channel cursor behavior, conversation UI, workplace and build checks.
- The isolated coordinator window-closes-before-hello failure test passed, covering the failure path the builder had previously only inspected.
- After the final field-heading and unread-circle fixes, the four original UI/build regression files passed **47 tests**, one worker. Targeted profile/unread checks also passed; the circle regression was first demonstrated failing against the earlier build.
- Fixture browser smoke passed with no page/console errors. Screenshots inspected: `/tmp/wp-unread-oval-shots/chat-unread-{light,dark}.png`, plus the profile and Mail images. The fixtures contain synthetic people and text only.
- The isolated real Electron entry/return check passed and invoked the actual profile preload/IPC bridge with an unavailable identity. The Node backend test separately verifies positive full-Self reads and snapshot-body exclusion.
- Final non-writing Biome check passed for 20 scoped source/test files; context lint passed for 204 files. Diff and edit-corruption checks passed. All five canonical UI source copies match, and the integration patch is refreshed.

### Existing failure left unchanged

`apps/agent-world/tests/backend.test.ts` still expects retiring `org-b` to return immediate `applied`. HEAD's lifecycle implementation already returns asynchronous `accepted` with a departure-progress note. The unfiltered focused run reproduced this mismatch. It was left unchanged; the later command explicitly excluded that one test. This is not a clean full-suite claim.

## Live activation

The preview application was reopened for the new profile bridge before wider checks finished. The operator approved the runtime restart. Before stopping PID **75687**, checks found no daemon-owned children and no pending starts. Replacement PID **23011** loaded the new column; all **six** previously live Pi processes reconnected with their same PIDs. No pre-existing person's hire date was filled in. Evidence: `/tmp/wp-details-live-restart.log`.

The final oval fix is built and available on preview reload (Cmd+R); a reload clears this spike's in-memory drafts. No live hires or validation messages were sent, no full suite ran, and no commit was made. The native runtime's existing run-level/index-recovery semantics remain in place; this does not introduce message-level DM acknowledgments or prove every live delivery/recovery path.

## Evidence

- `/tmp/wp-details-verified-tests.log`: unfiltered run and the retirement mismatch; also the corrected own-post cursor assumption.
- `/tmp/wp-details-verified2-tests.log`: 62 passed, one excluded retirement test.
- `/tmp/wp-details-window-failure.log`: isolated tmux failed-start path.
- `/tmp/wp-details-final2-types.log`, `/tmp/wp-details-final2-ui-tests.log`: final typecheck and 47 UI/build tests.
- `/tmp/wp-unread-oval-red.log`, `/tmp/wp-unread-oval-green.log`: rendered circle regression and passing profile/unread checks.
- `/tmp/wp-unread-oval-smoke.log`, `/tmp/wp-unread-oval-shots/`: representative unread, profile, Mail and channel checks/images.
- `/tmp/wp-details-final-electron.log`: real isolated host entry, profile IPC and return.

The canonical UI source snapshots and integration patch under `prototype/` are refreshed. The spike remains available for operator evaluation; it is not final product adoption.

## Post-delivery maintainer review

Reviewed the requested production, fixture, operational-script and four test paths against the current goal. Kept the on-demand Self test: excluding its full body from snapshots is an explicit requirement, not an invented negative case. Left the unrelated retirement test unchanged. No runtime restart or one-shot restart-script rerun was needed.

Replaced the direct projection hire-date tests with public backend snapshot cases covering awake/dormant people, later incarnations, and a database physically missing the column. Channel tests now assert the returned pre-read cursor against the returned own-post sequence, actual inbox unread totals, and refused private reads, rather than inspecting participant tables. Profile checks verify each field's visible text and independent expansion/collapse instead of a global region count. The unread test now holds a newest-page response while a previously loaded DM receives a new run state, proving that stale loaded history cannot clear that update. Its cue disappears after acknowledgment. Circle checks in both the regression and smoke now protect roundness and fitting within the name line, rather than fixing a CSS diameter; light contrast checks protect readability rather than a border width.

Separated Mail navigation from the profile test and selected Activity before checking its heading. This exposed a real missed rename: the button said Activity while its destination still said Organization traffic. The heading now says Activity; the internal traffic key and delivery-record semantics are unchanged. The initial regression failed against the earlier build, then passed after that one-label correction. Also bounded fixture-script checkout discovery at the filesystem root, matching the existing real-Electron check, and corrected the obsolete comment claiming that all later channel reads were explicit.

Verification: combined typecheck/build passed; the four requested test files plus the build check passed **55 tests**, one worker, with the same one pre-existing retirement test explicitly excluded. After the last expansion/cue assertions, all three targeted profile/unread/Mail tests passed again. The updated fixture smoke and isolated real Electron entry/profile IPC check passed. Evidence: `/tmp/wp-maintainer2-{initial,tests,final-target,smoke,electron}.log`. Historical results above remain the results of their own runs; they are not a full-suite claim. The completed assignment's stale Pending completion line is removed, and the fifth-iteration snapshot-only Self constraint is explicitly superseded by the on-demand reader. Final context lint passed for 206 files; scoped Biome/diff checks and all five canonical-source comparisons passed, and the 26-path integration patch is refreshed. After the comment-only clarification, the world was rebuilt and its freshness test passed again. A copied-out smoke probe also exited with the checkout error before launching Chrome (`/tmp/wp-maintainer2-missing-root.log`).
