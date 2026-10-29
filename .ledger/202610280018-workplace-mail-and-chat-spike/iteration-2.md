# Workplace refinement: Slack rhythm, Gmail structure

## Operator request

Refine the working spike using https://github.com/ncvgl/slawk as a visual/interaction reference. Prioritize agent session DMs, a tool-call visibility toggle, and Slack-like typing feedback. Keep Mail recognizably Gmail-like, with Slack's visual language. Here, a DM opens an agent's actual Pi session and can redirect its work; Mail is durable asynchronous correspondence between thread participants.

## Reference inspected

Read Slawk's DM conversation, message rows, and CSS tokens from a shallow checkout at revision `5f30358`. The repository's license is MIT, copyright Nathan Cavaglione. This iteration takes design cues, not source, fonts, assets, dependencies, message storage, or authentication code. The reference's fixed avatar gutter, compact author/timestamp headers, message density, plum workspace chrome, and quiet composer informed the implementation. No third-party code was imported.

## Changes

- A compact plum workspace header and icon rail, light sidebar, quieter selection states, and consistent typography across Chat and Mail.
- Session messages use an avatar gutter and readable author/time hierarchy. Markdown, code, tools, paging, live streaming, and receipts still use the existing session implementation.
- Tool calls are hidden by default in workplace DMs. The header toggle reveals the existing expandable calls and results. This is display-only: original history, paging, and streaming are untouched. Failed tools retain a visible warning even when hidden, and a tool-only transcript explains why no conversational text is shown. The original World modal continues to show tools by default.
- Activity comes from the actual run state: writing_reply says typing, thinking says thinking, running_tool says working, compacting says updating context. Idle, sleeping, and asking sessions do not receive fake typing indicators. Reduced-motion preferences disable the dot animation.
- A focused-task context strip makes the session's current assignment visible without opening a separate profile panel.
- Mail retains its folders/inbox/reader structure but uses the workspace palette. Sender avatars, recipients, timestamps, subject hierarchy, and inline replies make a thread read like correspondence, not delivery traffic. Unread filtering is functional; search is still limited to available snapshot data.

## Boundaries retained

Session inputs are still direct instructions with distinct immediate redirect, after-this, and stop actions. Mail and channel posts are runtime thread commands. Channel observation is not membership. Fixed mail subjects, explicit Read latest, delivery-only Sent/traffic records, and in-memory drafts remain spike limits. No new backend, database, routing runtime, or editor was added.

## Try it

The rebuilt Agent World was reopened for the operator. Click Workplace spike at the top left, choose an agent, and use Tool calls in its header. Mail is in the left rail. These are live runtime surfaces; sending performs real commands.

Fixture screenshots from the final implementation check: `/tmp/wp-refine-final-shots/` (temporary files; run the smoke command in `README.md` to recreate them). The fixture check now covers tool visibility, streamed text while tools are hidden, working/typing/idle transitions, unread filtering, and the earlier mail/channel flows. The real isolated Electron navigation check passed before reopening the application. Final focused validation and remaining limits are recorded in `iteration-2-retrospective.md`. The next step is the operator's evaluation of the open preview, not production adoption.
