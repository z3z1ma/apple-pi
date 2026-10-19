## file

`FRAMES` and `STILL` index the 16-cell character strips in the order the Codex prompt asks for and `clean_characters.py` keeps: walk down 0–3, walk up 4–7, walk left 8–11 (right is left mirrored), then sit-back A, sit-back B, stand, ask (12–15). `STANDING` equals `HEIGHT` in `clean_characters.py`, the standing height every frame is scaled to.
Why: the strip carries no labels; regenerating a sheet with rows in another order, or changing `HEIGHT`, silently shows wrong poses or wrongly sized characters.
Coupled: .ledger/202610171741-guildworld/prototypes/headquarters/generate_characters.sh, .ledger/202610171741-guildworld/prototypes/headquarters/clean_characters.py

## symbol:PlaceScene.addPerson

A seated agent's sprite is lowered by `lift` (a negative lift of 0.32 tiles) onto the stool painted at its spot, and its own shadow is hidden; this only looks right because every `pose: "sit"` spot in `places.js` is the centre of a stool traced on that room's painting, and the seated frames draw no seat.
Why: the sprites' seats were removed so they would not double the painted stools; moving a spot off its stool, or regenerating seated frames with a seat, makes agents float or sit on two stools.
Coupled: .ledger/202610171741-guildworld/prototypes/headquarters/src/places.js, .ledger/202610171741-guildworld/prototypes/headquarters/generate_characters.sh
