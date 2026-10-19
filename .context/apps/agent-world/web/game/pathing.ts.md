## file

Two kinds of obstacle exist. `blocked` (furniture traced in the place data) is never walked on. `occupied` (other characters' footprints) costs `PAST_SOMEONE` times more per step and is never a goal. A string-pulled run may cross a footprint only where the raw A* path also squeezed past someone.
Why: characters stand at spots in one-tile aisles (the large wing's lower desks against the south wall), and hard footprints cut the entry off from the rest of the room. Decision 23 says characters block only their own footprint.
Verify: apps/agent-world/tests/pathing.test.ts

`pull` requires each straight run to keep a clearance blended between what its two ends have, capped at `BODY_CLEARANCE`, rather than a fixed body width. A fixed width would refuse to leave a start beside a table or pass a gap narrower than a body. A width taken as the minimum over the stretch would let a long run graze every wall at the gap's width.

`findPath` pulls the raw path, `unjog`s it, and pulls again. `unjog` drops a corner that makes a sideways step shorter than `JOG` tiles between two longer runs, when the run that replaces it keeps about the clearance the jog had (`JOG_SLACK`) and crosses no footprint the jog avoided.
Why: A* on the half-tile grid lines up with a doorway or a desk half a tile off, and the walker visibly side-steps there; the polish bar (Further Notes of `.ledger/202610171741-guildworld/spec.md`) asks for none.
Verify: apps/agent-world/tests/pathing.test.ts
