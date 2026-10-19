# 18: Theme pack format and pack check

**What to build:** The fantasy theme becomes the first theme pack: a manifest with labels and interface and panel style tokens, the places with their data files, the character sheets and portraits, and the overlays, all in the shared conventions. The pack check reports missing required pieces, wrong sheet layouts, grids outside their paintings, and entries, stand points, or spots off open floor. A broken pack fails safely: the world falls back to the last good theme and says why. Each later place ticket adds its place to the required list.

**Blocked by:** 11 Headquarters polish pass; 15 The inn; 16 The rookery and mail

**Status:** ready-for-agent

- [ ] The fantasy pack passes the check; fixture packs with each kind of fault fail with a message naming the file and fault.
- [ ] Loading a broken pack still opens the world in the last good theme with a visible notice.
- [ ] No theme-specific text or style remains in the world UI code outside the pack.
