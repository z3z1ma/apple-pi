Status: done
Created: 2026-10-28

# Spike workplace mail, chat, and org chart interfaces

## Intent

Build a thin Gmail-like mail interface and Slack-like interface over existing Agent World workplace capabilities. Agents appear as direct session conversations; first-class team channels appear as channels. Reuse existing runtime ownership and delivery semantics, validate focused checks, and keep the scope to a spike.

## Current state and next action

The operator adopted Chat and Mail as first-class Workplace functionality on 2026-10-29 and authorized semantic commits to main. Neutral live naming, product documentation in `docs/workplace.md`, and maintained validation scripts in `apps/agent-world/scripts/` replace the temporary integration contract. World remains the initial view. This bundle retains evaluation evidence; Org now has its own owner at `.ledger/202610290925-org-chart-and-task-specific-teams/`, whose `plan.md` is proposed, not implemented.

## Follow-up: Slack-like session UX

The operator continued the spike with https://github.com/ncvgl/slawk as a reference. Raise the visual and interaction quality of agent DMs, add a tool-call visibility toggle and truthful typing feedback, and give Mail Gmail structure with compatible Slack styling. Keep the existing session and thread semantics. Design choices and evidence are in `iteration-2.md`.

Acceptance: the operator can open the refined live UI; tool visibility leaves conversational text, live streaming, and failures visible; activity matches the real run state; Mail keeps its thread/reply semantics; focused browser and original-interface checks pass.

## Follow-up: appearance and channel participation

The operator said the direction was looking decent and requested dark mode, Markdown in team channels, an operator Join/Leave bridge with Slack-style controls, and more polish.

Acceptance: light/dark appearance works across Chat, Mail, and embedded session controls; channels share safe Markdown rendering with session DMs; an explicit runtime command joins/leaves existing team channels as operator without granting private-thread access or changing others' cursors; posting follows returned membership and failures stay visible; drafts survive ordinary navigation; the real preview opens and focused checks pass. Implementation and verification are recorded in `iteration-3.md`.

## Follow-up: text-only DMs and compact activity

The operator supplied workplace and Slack screenshots and clarified that tools off means only assistant/user written text. This supersedes the earlier forced-failure-warning design: thoughts, notifications, tool results, mail entries, and historical error/stop banners stay in the full history but are absent from text-only rendering. Keep the DM header short, put current tool detail only in a truncated lower activity line, repair the composer's split outline, and add restrained polish. Acceptance and evidence are in `iteration-4.md`.

## Follow-up: names, avatars, and profiles

The operator asked for names in chat to open DMs, avatars in chat/DM to open profiles, and varied theme-compatible avatar colors. Acceptance and evidence are in `iteration-5.md`: exact identity navigation, snapshot-only profiles, keyboard focus and draft retention, consistent colors, and read-only dormant/former histories. The sixth iteration below supersedes the snapshot-only Self limit with an on-demand reader.

## Follow-up: profile details, hire dates, and unread updates

The operator chose independent 200-character Record/Self previews, full Self grouped by field, and explicit hire-date recording with a clearly labelled First seen fallback. Strengthen only the light-theme question badge; preserve approved dark colors. Add familiar unread cues and new-message boundaries without inventing message counts or clearing updates while reading older content. Add Sent/Activity icons and rename Organization traffic to Activity. The operator's screenshot then exposed a stretched unread dot; fix its text-slot ownership and verify rendered dimensions in both themes.

Acceptance and verification are in `iteration-6.md`. The approved runtime restart enables future hire-date recording while leaving old dates null.

## Follow-up: Org chart and task-specific teams

The operator wants an Org tab in the same workplace styles: independent reporting trees, profile access, drag-to-restructure including cross-team moves and splitting branches, role-based teammate creation, shared whole-tree channels, and work launched through the head. The operator chose planned role slots until Start team, cross-team restructuring, and a channel for the whole descendant tree alongside existing local channels. The proposal moved to `.ledger/202610290925-org-chart-and-task-specific-teams/plan.md` when Workplace was adopted; implementation awaits review. No Org runtime mutation or live validation launch has occurred.

## Outcome

Adopted as first-class Workplace functionality. Live modules, entry link, header and window title have permanent names; historical prototype copies remain unchanged. Product docs own current behavior, and maintained fixture/Electron scripts live under `apps/agent-world/scripts/`. Final adoption checks: combined typecheck, 10 focused files / 78 tests with one worker and no exclusions, rendered fixture smoke, and real isolated Electron navigation/profile IPC passed. The obsolete retirement scenario was corrected to accepted-then-departed behavior and no new sleeper; production retirement behavior was not changed. No live validation messages/hires, full suite or new daemon restart. Commit and packaging evidence follows in `adoption.md`.

### Earlier evaluation outcomes

Sixth preview built and available. Full Self is on demand and field-grouped; Record and each field expand independently; dates distinguish Hired from First seen; light questions have stronger contrast; unread DMs/channels have real state cues and latest controls; Sent/Activity have icons. The oval indicator was reproduced at 81-by-7 and corrected to a fixed 7-by-7 dot in light/dark checks. The approved daemon replacement kept all six Pi PIDs and reconnected their bridges, with no backfilled hire dates. Evidence and the unrelated pre-existing retirement-test mismatch are recorded in `iteration-6.md`. No live validation hires/messages, full suite, or commit.

Fifth preview built and made available before wider checks completed: navigable chat names, profile avatars and a profile side pane, six stable theme-aware avatar hues. Final build/typecheck passed; four focused files passed 43 tests with one worker, plus the extended former-member boundary rerun. Fixture smoke, real isolated Electron navigation, scoped Biome, context lint (203 files), and diff checks passed. No daemon restart, live validation messages, full suite, or commit.

Fourth preview built and available through World -> Workplace spike. Text-only transcript, continuous composer border, compact state/role header, and ellipsized live tool activity are implemented. Four focused files passed 39 tests with one worker; combined typecheck, fixture smoke, real Electron navigation, scoped Biome, context lint (202 files), and diff checks passed. No runtime restart or live validation messages in this iteration.

Third preview delivered and reopened: remembered dark/light appearance, channel Markdown, explicit operator Join/Leave, and focused UI polish. Final build, combined typecheck, eight focused test files (46 tests, one worker), fixture smoke, isolated real Electron navigation, context lint (201 files), focused Biome, and diff checks passed. The existing runtime was restarted to load the membership command; Pi sessions stayed running. No live messages were sent for validation and no commit or full suite was run. Operator evaluation remains open; details are in `iteration-3.md`. A later test-only review separated the browser behaviors and passed all 22 conversation tests, typecheck, and fixture smoke without changing production source; the earlier eight-file result was not rerun.

### Initial spike assignment 338: Tadhg Marinescu

Built and opened a working Gmail-like Mail and Slack-like Chat spike over the existing Agent World API. Agents have actual session DMs; team channels preserve observation and participant posting; Mail supports inbox, reply-all, compose, and delivery logs. Fixed the operator-reported blocked launcher by permitting only exact internal Electron routes; the real isolated Electron click-through now enters the spike and returns to World. Preserved prototype sources and run notes in the ledger. Final combined typecheck passed; fixture browser smoke passed; four original-interface regression files passed 33 tests with one worker; context lint passed. No live messages were sent for validation, no runtime daemon restarted, and no full suite or commit performed. Temporary integration remains available for the operator's verdict.
