# 01: Cursor and click markers

**What to build:** The pointer is a hand with a pointing finger in the theme's style instead of the default arrow. Over something with an interaction it animates (a small bob or tap); over floor that cannot be walked to and has no interaction it turns grey or becomes a closed fist. A click on floor leaves a small yellow X where the avatar is heading, RuneScape-style; a click on something with an interaction leaves a red X on it. Both fade quickly.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] The default arrow never shows over the world; HTML panels keep a normal pointer for text and buttons.
- [ ] Hovering a character, door, fidget, or host shows the animated hand; hovering unwalkable floor with no interaction shows the grey or closed hand; hovering open floor shows the plain hand.
- [ ] A left click on open floor draws a yellow X at the destination; a click on an interaction draws a red X on the target; each fades within about half a second.
- [ ] Judged on screenshots in all three themes against `apps/agent-world/art/STYLE.md` and the polish bar in `.ledger/history/202610171741-guildworld/spec.md` (Further Notes).
