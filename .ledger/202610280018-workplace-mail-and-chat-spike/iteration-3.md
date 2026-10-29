# Third iteration: appearance and team participation

## Operator direction

The operator said the preview was looking decent, requested dark mode and Markdown in team channels, and asked for an explicit operator Join/Leave bridge and Slack-style controls rather than requiring an invitation. Continue polishing the chosen interface, not exploring unrelated layouts.

## Delivered design

- A Theme switch in the application rail, shared by Chat and Mail. It starts from the OS preference and remembers an explicit light/dark choice. Semantic palette tokens cover sidebars, text, code, tables, tools, forms, warnings, and native controls.
- Team messages reuse the session Markdown renderer: headings, emphasis, lists, code, tables, safe web/file links, and the same untrusted-content rules. Raw HTML is literal text; remote images are alt text; unsafe schemes are inert. Web and file links go through the existing main-process bridge, including keyboard and middle clicks. Relative files use only a known author directory; without one, the existing backend can open an absolute link but refuses a relative path.
- Nonmembers see a preview callout and Join channel. Members get a Joined disclosure with Leave channel. Membership remains unchanged in the UI until the command succeeds and the reader returns the new participation. Failures remain visible, and a failed join never enables posting.
- Channel Enter posts; Shift+Enter inserts a line; IME composition is preserved. Mail replies also accept Command/Ctrl+Enter. Channels open at their latest messages, and successful replies scroll to the returned post. Read latest remains explicit.
- Stronger text contrast, coordinated focus feedback, native dark form controls, visible questionnaire selections, a bounded-height compose window, and compose recipient retention when closing/reopening a draft. Tool hiding, session activity, receipts, stop/redirect/follow-up, and hidden-reader cleanup retain their contracts.

## Bridge and authority

`AgentWorldApi.setChannelMembership(thread, joined)` calls `world:channel-membership`, which sends `{ kind: "channel_membership", thread, joined }` as operator through the existing runtime client. The runtime owns all membership writes and ordinary audience events. Only an existing team channel is eligible; private mail, meetings, tasks, escalations, missing channels, malformed input, and a person's attempt to use the operator command are refused.

Join adds an invited pull participant so reconciliation and restart retain it. A first join has cursor 0; a repeat preserves the cursor; leave deletes participation; rejoin starts fresh. The command itself marks nothing read. The UI rereads after an applied join receipt, acknowledging only the history now returned through the existing participant reader. Observation never joins. Membership and its ordinary event commit together, and accepted commands recover idempotently after a crash. No schema, parallel store, or new daemon was introduced.

The old runtime was restarted once to load the new command (old PID 72968, replacement PID 75687), and Agent World was reopened (PID 76347). Pi sessions were not restarted. No live channel or mail messages were sent as validation; join/leave and delivery tests use isolated runtime databases or the in-memory UI bridge.

## First-user evidence

Amos reran the fixture at `/tmp/wp-dark-amos`. He found the dark palette readable and consistent, understood preview/join/post/leave, confirmed the remembered theme and truthful session activity, and observed that refused joins did not expose the composer. The hostile Markdown probes confused him visually until explained; the run notes now identify those probes explicitly. He confirmed that script did not execute, unsafe links stayed inactive, and image output was alt text. His report does not claim live runtime delivery was exercised.

## Verification

Final build and combined Node/web typecheck passed. Eight focused test files passed 46 tests with one worker: runtime membership and crash recovery, Agent World membership integration, conversation/UI behavior, original interface/workplace regressions, link security, and built-asset consistency. The new UI regression covers appearance persistence, Markdown safety and keyboard/middle-click link handling, explicit membership, refused joins/leaves, keyboard posting, and draft retention. The extended fixture passed, and the isolated real Electron click-through entered the workplace and returned to World. Focused Biome, context lint (201 files), and diff checks passed. Inspected final dark/light Chat and dark Mail screenshots.

Evidence: `/tmp/wp-dark-final-{build,types,tests,smoke,electron}.log`; screenshots: `/tmp/wp-dark-final-shots`. Earlier smoke failures were selector assumptions about the native Joined disclosure, corrected by giving the control an explicit accessible label. No product authorization or rendering assertion was relaxed.

No full suite or commit was requested.

## Follow-up test and simplicity review

Split the combined appearance/Markdown/membership browser scenario into independent behavior checks, and added a direct check that closing and reopening a compose draft keeps both body and recipient across Chat/Mail switches. Appearance now also checks Mail's visible palette. Markdown checks require the escaped tag text and image alt text to be visible; an unset script marker alone would not prove escaping, because scripts inserted through innerHTML are already inert. The image restriction targets the untrusted probe, leaving decorative UI imagery unconstrained. The smoke uses the same visible-text checks instead of a header CSS selector.

Kept the production TSX and CSS unchanged: the current palette, shared renderer, runtime bridge, and scoped session overrides already preserve the requested behavior without a useful smaller abstraction. Clarified the command table's operator address, current verification links, and the boundary between initial and later task history.

After this review, combined Node/web typecheck, all 22 conversation tests with one worker, fixture smoke, scoped Biome, context lint (202 files), and diff checks passed. Logs: `/tmp/wp-dark-review-{types,tests,smoke}.log`. The earlier eight-file run remains its own 46-test result; it was not repeated after these test-only edits. No new build or Electron/runtime restart was needed because production source did not change. Live delivery and the full suite remain unverified by this review.
