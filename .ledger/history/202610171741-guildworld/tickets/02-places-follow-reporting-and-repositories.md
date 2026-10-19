# 02: Places follow reporting and repositories

**What to build:** Characters stand where they belong. The coordinator is in the headquarters hall. Agents that report to it work in the wing of their repository, reached through a gallery of doors, each with its repository's banner. A wing stays once seen, boarded up when empty, and is remembered through `set_preference`. Agents outside any repository sit in the common room. Independent agents stand in the exterior. Dormant agents appear in no awake place. A wing room comes in the size that fits its headcount, and several agents can share a table.

**Blocked by:** 01 Agent World opens over the real runtime

**Status:** done

- [x] In the backend API test, a worker reporting to a coordinator from repository A is in wing A, a session without a repository is in the common room, an independent session is in the exterior, and a stopped session is in no awake place.
- [x] A wing that has had an agent stays in the gallery after its last agent stops, boarded, and still appears after the app restarts.
- [x] Wings keep first-seen order, and the gallery repeats its painted niche for each extra wing.
- [x] A wing with more agents than the small room's spots uses the large room; a crowded room seats several agents at one table.
- [x] Two coordinators each get their own headquarters.
