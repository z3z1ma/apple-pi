## file

`niches.layouts` and `niches.repeat` were cut by measurement against this exact `gallery.png`. The wall's period is 297 painting px, which is 5.357 tiles at 32 tiles across. Each cut pair was chosen where columns x and x + k·297 px match. A cut must also keep the right niche centres on the correct side of `from <= x < to`: niche 2 at 10.67 sits just outside the 2-niche layout's 10.661 cut. A repainted or re-cropped gallery invalidates every cut, so remeasure them with a column-difference scan rather than nudging the numbers.
Why: the painting is only nearly periodic (niche spacing 5.45/5.36/5.33/5.40 tiles), and its lower furniture does not repeat at all. Cuts taken from the nominal spacing show seams, and a centre on the wrong side of a cut gives the wrong niche count.
Coupled: apps/agent-world/themes/tech-office/places/gallery.png, apps/agent-world/web/game/layout.ts
Verify: apps/agent-world/tests/places.test.ts
