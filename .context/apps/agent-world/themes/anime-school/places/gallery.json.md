## file

`niches.layouts` and `niches.repeat` were measured against this exact `gallery.png` (32 tiles across). Niche centres in `at` come from the dark doorway runs; each layout's cut pair was picked by a column-difference search where the wall band and the full height both match. Every cut must keep each niche centre on the correct side of `from <= x < to`, so each layout keeps exactly its number of niches. A repainted or re-cropped gallery invalidates every cut, so remeasure with a column-difference scan instead of nudging the numbers.
Why: the painted niches are only nearly periodic (spacing 4.55–4.59 tiles), so cuts taken from the nominal spacing show seams, and a centre on the wrong side of a cut gives the wrong niche count.
Coupled: apps/agent-world/themes/anime-school/places/gallery.png, apps/agent-world/web/game/layout.ts
Verify: apps/agent-world/tests/places.test.ts
