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

## symbol:drawSigns

Every door with a `sign` gets the place's themed label (`signName`: without its article, "The forge" is "Forge") lettered on its board in the pack's `world.sign` style, at the largest size that fits on one line (else two), never below 10 px; then no sign on the street is lettered more than `SIGN_KIN` (1.25×) the smallest, so the signs read as a set ("Inn" on a big board shouted). On a painted board the letters keep 10% of its height and 4 px clear; on a drawn plate they come up to its rim.
Why: ticket 04 of `.ledger/202610191114-agent-world-alive/` asks for names legible at the default zoom (48 px per tile in the squares at 1280 × 800). The fantasy square paints hanging slates about 0.7 × 0.55 tiles (34 × 26 px; the rookery's is seen side-on, 25 px wide) and none for the guild hall or the quest office, too small for a name at 10 px, so every fantasy sign is a `plate` the world draws (slate and iron colours sampled from the painting) over where the painted slate hangs. The tech plaza's blank light boxes and the anime school's cream boards are lettered as painted. Repainting the fantasy square with larger blank boards (and boards for the guild hall and the quest office) would let its signs drop `plate`.
Coupled: apps/agent-world/themes/fantasy/places/square.json, apps/agent-world/themes/tech-office/places/square.json, apps/agent-world/themes/anime-school/places/square.json, apps/agent-world/themes/fantasy/theme.json, apps/agent-world/web/game/place-scene.ts
Verify: apps/agent-world/tests/world-square.test.ts, apps/agent-world/tests/places.test.ts
