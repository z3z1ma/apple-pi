## symbol:role_of

A look's role in the `looks.json` that `build` writes comes only from its name in the briefs: `avatar-*`, `townsfolk-*`, `coordinator`, and the host names in `HOSTS`; any other name is an agent look. The theme pack check requires every role it lists, so a host renamed in a brief, or a new host added only to the pack check, fails the pack.
Why: role is not stored in the briefs; the name is the only link between a generated sheet and its place in the world.
Coupled: apps/agent-world/src/theme-pack.ts, apps/agent-world/art/briefs/fantasy.json, apps/agent-world/art/briefs/tech-office.json, apps/agent-world/art/briefs/anime-school.json
Verify: apps/agent-world/tests/theme-pack.test.ts

## symbol:defringe

Edges are found with a padded neighbourhood (`interior`), never `np.roll`, and only two pixels are peeled.
Why: `np.roll` wraps the image border to the far side, so fringe on a sprite cut flush to its edge was never seen as edge and drew a pink line down the anime doors; peeling further than the blend depth eats real purple cloth or hair.
Verify: apps/agent-world/art/tests/test_pipeline.py

## symbol:sheet

Each sheet row is scaled on its own (walking rows by their median height, the last row by its standing frame), and each frame is cleaned before it is placed on the baseline.
Why: Codex draws each row at its own scale, so one scale per sheet made figures change size when they sat or raised a hand; cleaning after placing lifted frames whose bottom pixels were peeled off the baseline.
Verify: apps/agent-world/art/tests/test_pipeline.py
