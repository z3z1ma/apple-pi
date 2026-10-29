# Fifth iteration: people are navigable

## Request and acceptance

The operator asked for names in chat to open that person's DM, avatars in chat/DM to open a profile, and varied avatar colors within the theme. Keep identity tied to actual sender IDs, preserve drafts and reader effects, and support keyboard opening/closing without inventing accounts for unavailable people or the operator.

## Implementation

- Channel author names and participant names open the matching session DM through the existing selection path. DM author/header names use the same identity control. User-role messages retain the reader's You label, without a fabricated self-DM.
- Message, sidebar, and DM-header avatars open a profile side pane. It shows the current snapshot's role, soul/self headings, task/record, directory, model/context/cost and reporting facts when available, reusing the World examine card's fact-row builder. Its Message button enters the existing DM. No profile backend, account store, new runtime command, or World administration actions.
- Opening a profile neither reads a transcript nor marks a result seen. Entering a DM has its ordinary effects. Chat profiles unmount while Mail is visible. Escape/Close restores the exact clicked avatar, including when replacing an already-open profile; drafts survive. The pane overlays rather than squeezing a narrow conversation.
- Dormant and retained former members lead only to read-only history. Unavailable identities have no DM action. The operator's profile describes that separate identity rather than selecting the operator's Pi session by guesswork.
- Six muted hues derive from stable identity, with theme-specific lightness. Message, sidebar, header, and profile colors agree and survive rename, reload, and appearance changes. The hash follows the existing character-life ID-seeding pattern without importing Phaser. Palette is visual data, not a new preference/configuration system.
- Profile status stays compact. Detailed current commands remain in the lower DM activity line rather than expanding a profile into a wall of tool arguments. World retains its existing detailed examine card and transcript labels.

The profile surface is in `apps/agent-world/web/workplace-people.tsx`. Shared transcript author presentation has one optional embedding seam; channel Markdown's existing sanitizer and link interception remain unchanged. Sidebar avatar/name controls are siblings, not nested buttons.

## Evidence

- Final build and combined Node/web typecheck passed.
- Four relevant files passed **43 tests** with one worker, including all **27 conversation tests**. New checks cover author/participant navigation, no message send from navigation, snapshot-only profile reads, keyboard focus after replacement, draft retention, hidden-profile unmount, and color consistency across surfaces/rename/reload/appearance.
- A final targeted rerun additionally covered retained former-member history alongside dormant, operator, and unavailable profiles; it passed. No writable composer appears for dormant/former members.
- Extended fixture smoke passed, with dark/light profiles, a channel profile, and compact Chat screenshots in `/tmp/wp-people-final-shots`. Inspected those screenshots locally. The real isolated Electron launcher/return check passed. No live validation messages, daemon restart, full suite, or commit.
- Scoped Biome, context lint (203 files), and diff checks passed.
- Logs: `/tmp/wp-people-verified-{build,types,tests,smoke}.log`, `/tmp/wp-people-former-test.log`, `/tmp/wp-people-electron.log`.

The built preview was made available and the existing application brought forward before wider checks completed. Use World -> Workplace spike to load the fresh assets. The operator's final evaluation remains open.
