## file

The square's bound is its painting: townsfolk stand only on the place's painted `spots` that no agent holds (`townsfolkSpots` gets the free spot indexes from the scene's `showCharacters`), never on overflow floor, so at most `spots.length` minus the agents present stand there (8 of 10 with two independent agents in every pack today). The channels that stand are the first ones in the backend's order (mentions, then newest); every other unread channel is reached through the crier's list and the Slack tab.
Why: decision 25 and ticket 27 require a deliberate bound, not a constant. A pack's spots are where its art director left room for a person, with clearance, across the whole square; using them means the square never holds more figures than it was painted for, scales with each pack's own layout, and a new pack needs no new number. Agents come first because the square also holds independent agents (decision 05), and they are work; a townsperson makes way (fades out) when an agent needs its spot.
Coupled: apps/agent-world/themes/fantasy/places/square.json, apps/agent-world/themes/tech-office/places/square.json, apps/agent-world/themes/anime-school/places/square.json, apps/agent-world/web/game/place-scene.ts
Verify: apps/agent-world/tests/world-square.test.ts

A channel's look is chosen by `chooseTownsfolkLooks` as it comes to stand: the least-worn look among those standing, preferring the one it wore before (`keptLooks`) or its hash over the pack's `townsfolk` looks, so with six looks and up to ten standing every look is worn before any is worn twice (counts differ by at most one). Someone already standing never changes look; `townsfolkLook` returns the kept look, so the crier's list and the channel panel's portrait match the figure, and `forget()` clears the memory with the scene's other state.
Why: ticket 31; hashing alone put two of the same look side by side while others went unworn.
Verify: apps/agent-world/tests/world-square.test.ts

Townsfolk fade in and out on their spot rather than walking through a door: they stand for channels, not sessions, and a square that a refresh reshuffles must stay calm.

`drawUnreadBadge` centres the count on its ink (`measureText`'s actual bounding box against Phaser's `getTextMetrics().ascent`), not on the line box, so `1` and `88` sit in the middle alike; the prototype's numbers sat off centre. It never pulses (unlike the agents' state badges) so a square of unread channels stays calm; a channel that mentions the operator wears the theme's asking colour.
Verify: apps/agent-world/tests/world-square.test.ts
