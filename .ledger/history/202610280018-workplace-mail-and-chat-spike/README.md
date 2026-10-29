# Workplace mail and chat spike

Adopted on 2026-10-29. This bundle is historical evaluation evidence. Current behavior lives in `docs/workplace.md`; maintained checks are `apps/agent-world/scripts/workplace-smoke.mjs` and `workplace-electron-check.mjs`. Live navigation says **Workplace**, not Workplace spike. The evaluation instructions and prototype below describe earlier builds; they are not the product's current entry contract. See `adoption.md` for promotion evidence.

The operator continued this direction with a Slack-style UX refinement, then dark mode, channel Markdown, and explicit operator Join/Leave. See `iteration-2.md` for the first refinement, `iteration-3.md` for appearance and participation, `iteration-4.md` for text-only DMs, the composer fix, and compact activity, `iteration-5.md` for person navigation, profiles, and avatar colors, and `iteration-6.md` for expandable profile details, explicit hire dates, unread behavior, and Mail navigation. The Org follow-up is now owned by `.ledger/202610290925-org-chart-and-task-specific-teams/`.

## Proposed next step: Org

Org is not yet an available tab. Review `.ledger/202610290925-org-chart-and-task-specific-teams/plan.md` before implementation, especially its proposed rule for unfinished work during cross-team moves. After approval, the first delivery is a usable reporting forest, profiles and planned-role manipulation; validated live reporting changes, whole-team channels and controlled startup follow. Chat and Mail remain available through the entry below.

## Question

Does a familiar mail/chat shell make the existing organization easier to work with, without changing who owns its messages, sessions, and tasks?

The operator asked for a thin Gmail-like mail interface and a thin Slack-like chat interface, not a visual-options exercise. This is one working layout for each, over the existing Agent World preload API. The UI is deliberately temporary. The initial spike reused existing APIs only; the current refinement adds one explicit operator channel-membership bridge command. The latest refinement also adds a nullable runtime-owned hire-date column and an on-demand profile reader. Credentials, session ownership, and ordinary delivery ownership remain unchanged; unknown historical dates stay unknown.

## Evaluation entry (historical)

```sh
npm run build:world
```

Quit Agent World if it is open, then run `/world` in Pi. Click **Workplace spike** at the top left. Use **Chat** and **Mail** in the application rail; **World** returns to the original interface. The route is `index.html?workplace=chat` or `index.html?workplace=mail` in the existing Electron window. This is not a standalone web app: the live route needs Agent World's preload bridge.

The spike opens no new daemon. The existing runtime was restarted for channel membership and, with operator approval, again for hire-date recording; Pi sessions stayed running. **Theme** in the left rail switches light/dark appearance, starting from the OS setting and remembering an explicit choice. Clicking Send, replying to mail, instructing a session, or posting to a channel performs a **real runtime command as operator**. Reading an inbox thread advances the operator's read cursor through the messages returned; an embedded DM marks a result seen after its current newest page is loaded, focused, and at the latest position. Observing a channel as a nonparticipant changes no read cursor and does not join it.

## What is wired

- **Chat:** awake agents as DMs, sleeping agents' histories in an expandable list, and existing first-class team channels. Tools off shows only assistant/user written text; tools on restores thoughts, calls/results, notifications, mail entries, and historical errors. DMs reuse the real history and streaming, questionnaire, redirect/follow-up/stop controls, drafts, and receipts. Their header keeps a compact state plus role; only the lower activity line shows current tool detail, ellipsized to its available width with full text on hover. Names open the known person's DM, while message/header/sidebar avatars open an observational profile with a Message action. Full Self loads on demand under its four fields; Record and each Self field expand independently after 200 characters. Dates distinguish explicit Hired from fallback First seen. Unread live DMs have bold names and fixed round dots; the rail counts unread conversations. Six identity-stable avatar hues adapt to both appearances. Switching away unmounts the session reader and profile so a hidden DM does not mark later results seen.
- **Channels:** safe Markdown using the same renderer as session replies. Nonparticipants preview a thread and can explicitly **Join channel**; members can post through the ordinary reply command and choose **Joined → Leave channel**. Join/Leave uses the runtime bridge, not renderer database writes. A successful join rereads the now-visible history through the participant reader. Enter posts, Shift+Enter adds a line. Joined-channel counts use the operator's actual unread messages. A New messages divider uses the pre-read cursor. Focused readers at the latest position follow new posts; reading older posts leaves new content waiting behind a jump control, and read failures remain retryable.
- **Mail:** operator inbox, unread-message badges, subject filtering, full conversations, reply-to-all, and compose to an awake or sleeping agent. Sent and Activity have their own icons and remain delivery records, not invented full threads. Shared channel threads stay in Chat rather than being duplicated in this Inbox.
- **Disconnected:** retain the backend's last snapshot, show the disconnected label, and disable the workplace surface.

## Deliberate limits

- Compose uses the existing API's fixed subject, `Message from the operator`, with that limit stated in the form.
- Mail search covers available subjects and delivery text, not server-side full-text history.
- No archive, stars, fake presence, attachments, editor, new task system, or external Slack integration.
- Mail thread bodies retain explicit Read latest. Channels follow new posts only while focused at the latest position; DMs keep the existing history/streaming mechanisms and run-level unread-update flag, not a fabricated message count.
- Unsent bodies and compose recipient selection live in memory. Closing and reopening Compose retains its recipient and body; restarting the window discards them. Only the appearance preference is saved locally.
- A narrow viewport can scroll the mail list/reader horizontally; this spike targets desktop use.

## Fixture-only check and screenshots

```sh
node .ledger/202610280018-workplace-mail-and-chat-spike/smoke.mjs /tmp/workplace-spike-shots
```

This starts headless Chrome over the built UI and an in-memory fixture bridge. It never connects to the real runtime or sends real messages. It checks remembered appearance, session instructions and activity, tool visibility, safe Markdown and link failure feedback, preview/join/post/leave, refused membership, keyboard posting, mail reply/compose, disconnection, and browser/console errors. It saves light/dark Chat and Mail images, plus channel and membership states. The literal HTML, image alt text, and inactive unsafe link in the channel screenshots are intentional security probes, not incomplete rendering.

## First-user feedback

Amos Hargreaves ran the fixture check and inspected screenshots. He understood the session/channel distinction and busy-session timing controls. He found:

1. A posted message was missing from the screenshot because the fixture always returned the same messages. The fixture now appends accepted replies and checks that they appear.
2. Initially, Inbox counted unread threads while the Mail rail counted unread messages; those badges were aligned on messages. The sixth iteration separately labels Chat's unread-conversation unit.
3. Compose looked as though it lacked a subject field. The form now explicitly states the fixed-subject spike limit.
4. The channel receipt said Reply; it now says Post.

## Verification and verdict

Initial-spike verification is recorded in `retrospective.md`; second-iteration results are in `iteration-2-retrospective.md`, appearance/membership results are in `iteration-3.md`, text-only/composer results are in `iteration-4.md`, identity/profile results are in `iteration-5.md`, and current profile/date/unread results are in `iteration-6.md`. These distinguish build, TypeScript, focused browser checks, isolated runtime tests, and the real Electron entry check. No live messages were sent as validation. Live message delivery and the final design verdict remain for operator evaluation.

Earlier operator verdict: continue and refine the direction. The later adoption supersedes the temporary-integration instruction; preserve the historical canonical source under `prototype/` (`entry.ts`, `workplace-spike.tsx`, `workplace-spike.css`, `workplace-people.tsx`, `use-window-focus.ts`, and the integration patch). After a verdict, either remove the temporary entry and embedding seam, or use the learning to implement the chosen surface properly.
