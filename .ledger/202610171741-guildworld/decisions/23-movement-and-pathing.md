Type: prototype
Status: resolved
Blocked by: 15

# Movement and pathing

## Question

What makes walking feel right, given that RuneScape-style click-to-walk is the model and bad pathing alone can kill the experience?

The [headquarters prototype](../prototypes/headquarters/README.md) used an 8-direction tile path over a coarse hand-authored grid, one tile per 0.3 s, and the operator judged it subpar. Decide the walk grid resolution and how walkable areas are authored over a painting, path shape and smoothing, speed and turning, what happens on an unreachable click, how the avatar passes other characters, and how this stays true to RuneScape's feel. The operator judges the feel.

Prototype (2026-10-18): round 2 of [prototypes/headquarters/](../prototypes/headquarters/README.md); verdict pending.
Round 2 verdict (operator, 2026-10-18): continued progress; portraits beside the dialogue are great; the side walk had no in-between frames; pathing was still poor (the avatar could not pass between desks in the large room); painted stools doubled with the sprites' own; door targets were too big. Round 3 addresses these; verdict pending.

## Answer

Decided with the operator, 2026-10-18, after three rounds of the [headquarters prototype](../prototypes/headquarters/README.md). A decent baseline; polish comes later.

- **Interaction stays RuneScape's:** hover shows the default action, left click does it, right click opens every action (the browser's menu never appears), and the avatar walks up to a character or door before acting.
- **Movement is smooth:** an A* path on a walk grid twice as fine as the tiles, string-pulled into straight runs that keep a body's width from furniture, walked continuously and ending where you clicked; a click on furniture walks to the nearest open floor; a new click retargets at once.
- **Walk grids are traced by hand over each painting** on a labelled half-tile grid (fractional tiles), so aisles stay open; characters block only their own footprint; door targets cover only the door. An in-app grid view checks the tracing.
- **Paintings must leave room to move:** aisles at least a body and a half wide between furniture, and open floor wherever characters work, stand, or interact.
