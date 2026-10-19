## symbol:recruiterLook

Until a pack has a look whose role is `recruiter`, the square's recruiter borrows the pack's first `townsfolk` look (sorted by name), so it can look like a townsperson standing for a Slack channel; once the art pipeline adds a `recruiter` look, the recruiter wears it with no data change. A `look` named in `square.json`'s `recruiter` wins, and the pack check then requires it to exist with the `recruiter` role.
Coupled: apps/agent-world/src/theme-pack.ts, apps/agent-world/web/game/place-scene.ts, apps/agent-world/web/overlay/places/recruit.tsx
Verify: apps/agent-world/tests/world-recruit.test.ts, apps/agent-world/tests/recruit-pack.test.ts
