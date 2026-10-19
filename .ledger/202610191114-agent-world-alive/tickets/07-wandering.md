# 07: Wandering

**What to build:** Characters move a little on their own. Townsfolk and ambient NPCs stroll between points of interest in their place (a stall, the fountain, a bench) and pause there. Idle agents sometimes get up, take a few steps (to a window, a shelf, a neighbour's desk), and return to their spot; working and asking agents stay put. Hosts shift behind their counter. All of it uses the shared walker and pathing and never blocks the avatar.

**Blocked by:** 06 Idle animations

**Status:** ready-for-agent

- [ ] In a fixture square, townsfolk change position over time along walkable paths and pause at named points of interest.
- [ ] An idle agent leaves its spot and returns within a while; a working or asking agent never leaves its spot.
- [ ] A wandering character never stands on a door's stand point or blocks the avatar's path for long (the avatar's path stays found).
- [ ] Judged on screenshots in all three themes against `apps/agent-world/art/STYLE.md` and the polish bar in `.ledger/history/202610171741-guildworld/spec.md` (Further Notes).
