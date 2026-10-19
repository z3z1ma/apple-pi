# 08: Ambient NPCs

**What to build:** The world has characters who are there only for fun and immersion: each pack gets a cast (fantasy: a bard, a sleepy guard, a gossiping baker, a lost tourist; tech: a barista, a facilities person, a visitor, an office dog walker; anime: a strict hall monitor, a club senpai, a lunch lady, a gardener), each with a personality written in the pack: several rotating lines when talked to, a reaction when clicked repeatedly, idle animations, and wandering. They appear in the square, the new exterior, and fitting interiors (a bard in the inn, a guard at the hall doors). New looks come from the art pipeline.

**Blocked by:** 06 Idle animations; 07 Wandering

**Status:** ready-for-agent

- [ ] Each pack defines its ambient cast in `theme.json` (name, look, place, lines, reactions), validated by the pack check.
- [ ] Talking to an ambient NPC shows its next line in the small dialogue box; clicking it several times in a row gives its reaction.
- [ ] Ambient NPCs send no command and make no outside call.
- [ ] Judged on screenshots in all three themes against `apps/agent-world/art/STYLE.md` and the polish bar in `.ledger/history/202610171741-guildworld/spec.md` (Further Notes).
