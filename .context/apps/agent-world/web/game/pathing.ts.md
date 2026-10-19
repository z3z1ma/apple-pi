## file

Two kinds of obstacle exist. `blocked` (furniture traced in the place data) is never walked on. `occupied` (other characters' footprints) costs `PAST_SOMEONE` times more per step and is never a goal. A string-pulled run may cross a footprint only where the raw A* path also squeezed past someone.
Why: characters stand at spots in one-tile aisles (the large wing's lower desks against the south wall), and hard footprints cut the entry off from the rest of the room. Decision 23 says characters block only their own footprint.
Verify: apps/agent-world/tests/pathing.test.ts

`pull` requires each straight run to keep a clearance blended between what its two ends have, capped at `BODY_CLEARANCE`, rather than a fixed body width. A fixed width would refuse to leave a start beside a table or pass a gap narrower than a body. A width taken as the minimum over the stretch would let a long run graze every wall at the gap's width.
