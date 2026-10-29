# Org implementation proof

Updated: 2026-10-29. These are focused checks from separate runs, not a full-suite pass. Logs are local machine artifacts, not packaged fixtures. Build numbers below are the integration session's labels, not Git revisions.

## Final handoff: delivered build57

- Later Workplace work is committed through `f4268b78`; maintained native-check follow-up is `a467266c`. Build57 was opened after explicit operator approval: app PID98404 connected to unchanged runtime55346 (`/tmp/workplace-live57-open.log`). The prior app was already closed at preflight, so no process was forcibly terminated. This does not replace the earlier daemon-activation evidence.
- Build56 Org21 passed. Build57 reran the two changed organization-name/profile cases plus navigation3: **5 passed, 19 intentionally skipped**, 22.52s (`/tmp/hyejin-org-navigation-build57.log`). Names open metadata-only recorded work, Rename remains contextual, profile View all sits beside Work, explicit task reads and focus return remain covered. The other19 Org cases were not rerun on57.
- Retained World uses the common sidebar rather than top-level navigation. The final watcher regression passed both directions, and hidden readers/drafts were checked. Actual isolated native57 terminal/World/draft lifecycle passed20.2s (`/tmp/niamh-terminal-electron57.log`); native dialogs used simulated responses, not physical OS clicks.
- The existing maintained native check passed6.8s on57 (`/tmp/niamh-maintained-native57.log`), including read-free Org profile, blocked Org IPC/progress, retained parent/child documents for tab switches and an actual allowed full Chat-to-Org navigation. No live test person or paid-model turn was created.
- Both integrated typechecks, scoped Biome47, context lint282, build freshness1 and package inventory passed57. Inventory checked162 source/built paths; it is not installed-tarball startup proof. No full suite or remote push was performed.

The original Org undertaking is complete. Later specialization, idle-start and coding-workspace assignments are also delivered; their fuller evidence remains in their own completed task bundles. Current product contracts remain in `docs/workplace.md`, `docs/organization.md` and `docs/session-state.md`.

## Delivered build 53: idle starts and contextual controls

- Frozen build 53 Org browser checks passed **19/19**, one worker, 33.74s: `/tmp/fernanda-org-build53.log` (independently read). Coverage includes optional/whitespace goals, goal-free team readiness without a kickoff claim, unchanged existing-person work, locked partial retries, name-menu keyboard/focus/bounds, unopened-channel rename without a read, recorded-team search and card geometry. Screenshot `/tmp/fernanda-org-build53-shots/aw-org-light-organization-name.png` was inspected: the persistent Rename control is gone.
- Frozen build 53 Code/Issues browser checks passed **9/9**, one worker, 13.28s: `/tmp/hyejin-code-issues-build53.log` (independently read). This covers the second shared-menu consumer, tab close/dirty confirmation and repository boundaries, alongside save/conflict/Git and Issues behavior. These are isolated browser fixtures, not live actions.
- Integration owner Tadhg Marinescu reports runtime commit `8ced7e5a`, app commit `1d980095`, and approved activation from daemon PID 41110 to 55346. The same 13 Pi processes and their actual socket connections were verified; 113 existing people's metadata remained unchanged. App PID 77114 connected to runtime PID 55346; activation log: `/tmp/workplace-live53.log`. Workplace Chat is now the default entry; the World-default statement in the earlier activation checkpoint below describes that earlier release.
- A separate reflection backend test failed on an unrelated retirement fixture (`/tmp/workplace-reflection-backend-tests.log`); it is not included in the build 53 focused passing count. Rahul's subsequent action-time stale-menu correction also needs its own newer-artifact proof. Earlier checks below remain evidence for their stated versions, not implied reruns against build 53.

## Current source checks

| Boundary | Result | Evidence and limits |
| --- | --- | --- |
| Controller and public Org API | 17/17 passed, one worker | Niamh; `/tmp/niamh-org-safety-tests.log`. Includes editable preflight rejection, immutable prepared role/directory/goal, command-kind receipt filtering, and recorded initial-ready roster. Commands stand-in; actual runtime covered separately below. |
| Real runtime socket startup/retry | 1/1 passed, one worker | Wolfgang; `/tmp/wolfgang-org-runtime-final.log` (2.06s). Real controller, Commands socket, isolated runtime/database and World reader; only Pi executable replaced. Failed report retries keep identity and one goal, managers connect first, kickoff contains goal plus initial roster and reaches only head, late channel readiness reaches only head. Current roster-bearing production source, not the earlier exact-body contract. The final rerun includes the assertion-only reflection: observable manager-first/single-head/preserved-goal checks replace an exact failed-launch count. No real model turns. |
| Immediate Add person and existing recruit behavior | 17/17 passed, one worker | Ezra; `/tmp/ezra-add-person-regression.log`. New AddPerson backend tests plus existing isolated recruit suite. Does not prove the current rendered form geometry. |
| Integrated TypeScript | Node and web passed, reported by Niamh | `/tmp/niamh-org-safety-typecheck.log`; `npm run typecheck`, after startup safety and AddPerson/lifecycle source. Log contains both commands; successful exit reported by runner. Later renderer edits require current integration validation. |
| Temporary identity metadata and existing readers | 26/26 passed, one worker | Wolfgang; `/tmp/wolfgang-org-metadata.log`: temporary-metadata, backend and inn suites. Durable identity survives missing launch rows; dormant refresh and lasting descendants remain truthful. |
| Reporting changes/reconnect | 7/7 passed, one worker | Deniz; `/tmp/deniz-org-both-final.log`: organization and organization-move suites. Includes branch/work preservation and intentional null-manager behavior. |
| Whole-tree channel cases | 4/4 cases passed within an initially failing combined run | Niamh; `/tmp/niamh-whole-tree-tests.log` reports 5 passed/1 failed overall: the other suite's historical participation fixture failed on duplicate hired_at. Do not report this combined run as green. |
| Historical participation fixture repair | 2/2 passed separately | `/tmp/niamh-participation-repair.log`. Repairs the historical schema fixture, not runtime policy. |
| Existing local channels | 3/3 passed separately | `/tmp/niamh-local-channel-tests.log`. |

## Work-first revision (build38, current build39)

- Niamh reported work-history reader **4/4** plus existing workplace **3/3** passed. The reader retains recorded task anchors, repeated assignment participation, actual outcomes and known history read permissions. Successful combined log: `/tmp/niamh-work-history-tests-final.log`, 7/7 total, one worker, 8.83s.
- Deniz's pure metadata search tests **3/3 passed**, `/tmp/deniz-org-search.log`. Integrated Node and web typecheck then passed, `/tmp/deniz-org-search-typecheck.log`, including WorkHistory/profile/search integration. The initial typecheck hit a Node-to-TSX test import; extracting the shared pure projection fixed the boundary without a configuration change.
- Root reports **build38 and build39 passed**. Build39 changes focused history to a compact summary with explicit expansion, preserving chart space. Hye's **9/9 Org cases passed** in 15.65s (`/tmp/hyejin-org-build39.log`). They cover top-down fitted geometry, direct selection/confirmation, work-history provenance, explicit task reads and global metadata search alongside existing behavior. Ezra's targeted profile cases passed **2/2, with 30 unrelated cases skipped**, `/tmp/ezra-profile-build39-final.log` (5.33s). Root inspected `/tmp/hyejin-org-build39/aw-org-light-team.png`: fitted four-person chart at 100%, compact summary and clear reporting layout.
- Root's current build39 actual-Electron check **passed in 6.1s**, `/tmp/org-final-electron.log` (exit 0 reported by root; PASS log inspected). It verifies actual World/Workplace/Org/direct-entry navigation, profile observation without transcript reads, blocked-request IPC and progress, and return to World over isolated runtime state. Capture path logged: `/var/folders/m0/1lt4df1s78xgj4s6yk5c9wp00000gp/T/workplace-electron-org-35517.png`. This is real Electron with stand-in people, not a live-team startup.
- Ezra's build39 freshness check **1/1 passed**, `/tmp/ezra-org-build39-freshness.log` (568ms). Current pack dry run: `/tmp/ezra-org-build39-pack.json`, 2,595 files, 61,589,720 bytes; required source/dist present as reported by Ezra. It proves inventory and current built-byte freshness, not installation from the packed tarball.
- Root's final no-edit `npm run typecheck` passed both Node and web, exit 0 in 8.6s: `/tmp/org-final-typecheck.log`. Final nonwriting Biome over all changed application source/test files passed: `/tmp/org-final-biome.log`.
- WorkHistory TSX/CSS passed scoped Biome; root context lint passed 234 files. These are static checks, not rendered proof. Runtime changes committed as `34e57b59`; application/source/built-assets/docs committed as `7d7c3e30`. Both commits verified with raw log/reflog/show.
- Renderer reload cannot load newly changed main/backend APIs. Fully quitting and relaunching Agent World loads the history API while leaving Pi sessions running; it clears memory-only drafts. This is separate from the shared daemon restart that still requires explicit approval.

## Earlier delivery check (before build38)

This run predates the work-history and search additions; the current build39 freshness and package-inventory results are recorded above. Ezra reported `build.test.ts` **1/1 passed**, one worker, with rebuild output only in a temporary directory: `/tmp/ezra-org-build-freshness.log`. `npm pack` dry-run inventory includes `src/org.ts`, `backend/org.ts`, lifecycle/world code and required built assets: `/tmp/ezra-org-pack.json`. Raw renderer source stays excluded intentionally by the manifest. Nonwriting Biome checked 17 relevant changed source files (`/tmp/ezra-org-delivery-biome.log`); context lint passed 226 files. These prove byte freshness and package inventory, not installation/startup from a packed tarball. Loader tests were not rerun because the extension/package-loader contract did not change.

## Renderer and actual host

- Hye's latest reported overview browser run against build36: **6/7 passed**. The failing case was the dark 900px Reports to hit-test, where the profile overlay intercepted the control. Screenshots: `/tmp/hyejin-org-overview`. Root built the overlay/modal/compact fixes as build37, then replaced the vertical outline in build38. See the current-build section above; this earlier result remains historical rather than proof of the later layouts.
- Wolfgang's actual installed Electron check against stable **build36 passed**, log `/tmp/wolfgang-org-electron.log`. The script opened World, Workplace Chat/Mail, Org's two-team overview, a focused hierarchy and a real profile, then returned to World. It separately clicked an actual `?workplace=org` anchor through Electron's navigation guard. Actual preload methods and a progress event worked; malformed/preflight-blocked requests created no people/start commands. Socket tracing saw no profile-driven transcript reads or acknowledgment requests.
- Inspected actual-Electron screenshot: `/tmp/wolfgang-org-electron-focused.png`. It is a focused team after closing the profile, not a profile screenshot. The fixture used isolated state and stand-in identities, with a failing fake Pi first on PATH. No live workplace was contacted.
- Electron progress and invoke replies arrive independently. The successful check waits for the progress event separately; the first immediate-event assertion was a test timing error, not a production defect. Subsequent script formatting and capture-path naming/logging passed static checks but were not another host run.

## Findings resolved during verification

1. The real runtime creates assignment-mail command IDs beneath start preparation IDs. Selecting all matching IDs made a failed launch look uncertain and blocked retry. Preparations now filter `kind='start'`; readiness publication recovery likewise filters `kind='thread_post'` rather than treating nested mail delivery as an unfinished post.
2. Ready membership cannot come from process timestamps: an existing awake person can arrive late, while an already-ready person can restart. The direct head kickoff now records its initial ready-person roster; later notices compare identities against it and prior notices.
3. A preflight rejection should allow correction only before setup has changed anything. Recorded setup activity freezes plan identity; prepared new-role/directory/goal changes fail explicitly.

## Approved live activation

The operator explicitly chose Activate now and Relaunch now. A fresh query-only preflight immediately before the cutover found runtime PID 23011, 11 alive tmux-backed Pi processes, no daemon children, no active program scopes/peers and no pending accepted/delivered non-mail control commands. Mail was queued; transport interruption/replay was disclosed. The team held new mutations during cutover.

Root ran `/tmp/org-activate-runtime.mjs`; `/tmp/org-live-activation.log` reports oldPid 23011, newPid 42962, samePiProcesses 11, verifiedSocketBridges 11, organizationChannels 21, unchangedPeople 111, reportingAndHireDatesPreserved true. Verification matched actual client socket peer addresses to the replacement daemon, not only database alive flags. The process performed no test hires/messages/reporting changes.

Approved Agent World main process 16372 exited, and 54660 launched the committed app. Its socket connection to runtime 42962 was verified. World remains the launch default; the approved relaunch clears memory-only app drafts but did not stop Pi sessions. The mutation freeze was lifted after verification.

## Remaining verification limits

- No full suite was requested or run; the two targeted profile cases intentionally skipped 30 unrelated cases.
- No real paid-model team startup or live reporting mutation was used for validation. Isolated runtime startup uses a stand-in Pi executable.
- Package inventory and byte freshness do not prove installation from the packed tarball.
- Send home / Call in remain through existing World lifecycle controls; they were not added as parallel Org actions.
