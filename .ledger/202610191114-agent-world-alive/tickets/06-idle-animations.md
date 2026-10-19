# 06: Idle animations

**What to build:** Every look gets a second sheet of idle frames: looking around, a stretch, a wave, a laugh, a shrug, a nod, and a yawn (in the art pipeline, for all three packs). Standing and waiting characters (agents, hosts, townsfolk) play them now and then, never in lockstep, so a room never looks frozen. The pack check validates the idle sheet's layout.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Every look in every pack has an idle sheet that passes the pack check (frame layout and baseline).
- [ ] A standing character plays an idle animation at irregular intervals; two characters standing side by side do not start the same idle at the same moment.
- [ ] Working and asking poses are unchanged.
- [ ] Judged on screenshots in all three themes against `apps/agent-world/art/STYLE.md` and the polish bar in `.ledger/history/202610171741-guildworld/spec.md` (Further Notes).
