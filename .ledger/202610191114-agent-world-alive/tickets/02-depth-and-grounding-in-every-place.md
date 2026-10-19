# 02: Depth and grounding in every place

**What to build:** Nothing floats or clips. Every place in every pack is audited for characters, hosts, and fidgets standing behind or in front of painted objects: foreground pieces trace only what truly stands in front (the tech and anime courtyard fountains are known bad), hosts stand on visible floor (the library's librarian looks like he floats), sleeping pets lie exactly on the furniture they sit on, and misplaced fidgets move (the bell in the fantasy square). The audit walks the avatar around every blocked rect and foreground piece in all 33 places and fixes what it finds.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] In every place of every pack, the avatar walking just north, south, east, and west of every foreground piece is drawn either fully in front or correctly hidden, never cut mid-body by something that stands behind it.
- [ ] Every host's feet are on painted floor visible to the viewer, not on a counter top or wall.
- [ ] Every fidget sits on the surface it is drawn on (floor, table, shelf) with its base on that surface.
- [ ] A test checks that no foreground piece overlaps a fountain basin or other floor area characters walk in front of, and that host spots are on open floor.
- [ ] Judged on screenshots in all three themes against `apps/agent-world/art/STYLE.md` and the polish bar in `.ledger/history/202610171741-guildworld/spec.md` (Further Notes).
