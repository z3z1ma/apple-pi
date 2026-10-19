# 12: Rename an agent; the recruit form fits

**What to build:** An agent's right-click menu (in the world and on its side-panel row) offers Rename, which opens a small themed form with its current name; saving sends the runtime's `rename` command and the character's name, banner rows, and chatbox follow. The recruit form's inputs stay inside their container at every window size (today they overflow to the right).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Rename on an awake agent sends `rename` with the new name and the receipt; the new name shows on the character, in the side panel, and in the conversation panel (backend test against a real runtime with a faux session).
- [ ] Renaming to a blank name is refused without sending anything.
- [ ] Every input and select in the recruit form sits inside its container at 1024x680, 1280x800, and 1680x1050 in all three themes (headless test comparing bounding boxes).
- [ ] Judged on screenshots in all three themes against `apps/agent-world/art/STYLE.md` and the polish bar in `.ledger/history/202610171741-guildworld/spec.md` (Further Notes).
