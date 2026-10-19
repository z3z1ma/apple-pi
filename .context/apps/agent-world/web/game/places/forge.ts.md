## file

Pieces are drawn at the depth of the bench's own foreground piece plus 0.2 (the foreground piece whose rect holds the slot's `at`), as the rookery's letters are: drawn at their slot's own `y` they would sink behind the bench that the foreground pass draws again over anyone north of its feet line.
Coupled: apps/agent-world/themes/fantasy/places/forge.json, apps/agent-world/themes/tech-office/places/forge.json, apps/agent-world/themes/anime-school/places/forge.json

A turned slot (`turn`, the fantasy blades) assumes a diagonal piece, pommel bottom left and tip top right: its pointer rect is the turned diagonal's extent plus `TURNED_THICKNESS`, not the turned image's bounds, which reach well past the bench onto the floor in front of it, where a click must walk.
Why: the blades are painted diagonally in a 612 x ~520 frame; unturned they only fit a bench about 1.45 tiles wide and poked past its back edge, turned 20 degrees a 1.8-tile frame lies flat along the bench (about 2.3 tiles of blade, the art brief's "about 3 squares").

The `work` slots replace the four `fidget` slots each pack's tracer had put on the benches: the art briefs (`apps/agent-world/art/briefs/*.json`, `scenes/forge/slots`) name "the empty tops of the four workbenches" and "the empty workbench mats" as the place for the crafted pieces, and no `work` kind existed then. Fidget objects on the benches would now overlap the pieces.
Verify: apps/agent-world/tests/world-forge.test.ts

Pull requests beyond the benches are counted in the place's title (`caption`, the host callback that sets the title's subtitle: "3 more on the rack"), not in a tag over the smith: the tag sat above the painting's top edge at the default zoom, off screen in every pack.
Verify: apps/agent-world/tests/world-forge.test.ts
