Type: prototype
Status: resolved
Blocked by: 15

# Characters and portraits

## Question

What do characters look like, how do they move and work, and what portrait appears when you talk to one?

The [headquarters prototype](../prototypes/headquarters/README.md) borrowed low-resolution town sprites and they killed the experience. Decide the sprite resolution and style that sit well in the painted interiors (somewhat higher definition is affordable), the animation set (walking that looks good, sitting and working at a table, idle life), how a character's look is chosen and kept per session, and the dialogue portrait: a RuneScape-style talking head beside the dialogue box, or a larger JRPG-style portrait with expressions on the left (the operator accepts either). Decide the pipeline that produces them per theme. The operator judges the feel.

Prototype (2026-10-18): round 2 of [prototypes/headquarters/](../prototypes/headquarters/README.md); verdict pending.
Round 2 verdict (operator, 2026-10-18): continued progress; portraits beside the dialogue are great; the side walk had no in-between frames; pathing was still poor (the avatar could not pass between desks in the large room); painted stools doubled with the sprites' own; door targets were too big. Round 3 addresses these; verdict pending.

## Answer

Decided with the operator, 2026-10-18, after three rounds of the [headquarters prototype](../prototypes/headquarters/README.md). A decent baseline; polish comes later.

- **Sprites:** characters at roughly three times the old resolution in the paintings' style (about 120 px standing, drawn 1.8 tiles tall), one Codex sheet of 16 frames per character: walk down, up, and left (right is left mirrored), each a four-phase cycle spelled out per frame (contact, passing with a lifted knee, contact, passing); sitting at work from behind (two frames); standing; asking with a raised hand. Frames are cut on their magenta gaps, scaled to one standing height, and set on one baseline; every character has a soft shadow.
- **Seats belong to sprites, not paintings.** A working sprite brings its own seat; paintings leave the work side of every table as open floor, so one table can seat several agents. Spots are the feet position on that floor.
- **Portraits:** four painted JRPG-style busts per character (neutral, happy, thinking, worried), shown large to the left of the dialogue box, chosen by the session's state (busy: thinking, asking you: worried, finished: happy); the line types out while the portrait bobs. The operator called this great.
- **Look per session:** chosen from the theme's character set by a hash of the session id, so a session keeps its look.
- **Known nits for later:** an asking agent standing beside a desk was placed about a tile too high; four-frame walks from one image are approximate; four facings only; no occlusion by furniture.
