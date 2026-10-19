## file

`FRAMES` and `STILL` index the 16-cell character strips in the order the Codex prompt asks for and `clean_characters.py` keeps: walk down 0–3, walk up 4–7, walk left 8–11 (right is left mirrored), then sit-back A, sit-back B, stand, ask (12–15). `STANDING` equals `HEIGHT` in `clean_characters.py`, the standing height every frame is scaled to.
Why: the strip carries no labels; regenerating a sheet with rows in another order, or changing `HEIGHT`, silently shows wrong poses or wrongly sized characters.
Coupled: .ledger/history/202610171741-guildworld/prototypes/headquarters/generate_characters.sh, .ledger/history/202610171741-guildworld/prototypes/headquarters/clean_characters.py

## symbol:PlaceScene.addPerson

A seated agent's sprite is lowered by `lift` (a negative lift of 0.32 tiles) onto the stool painted at its spot, and its own shadow is hidden; this only looks right because every `pose: "sit"` spot in `places.js` is the centre of a stool traced on that room's painting, and the seated frames draw no seat.
Why: the sprites' seats were removed so they would not double the painted stools; moving a spot off its stool, or regenerating seated frames with a seat, makes agents float or sit on two stools.
Coupled: .ledger/history/202610171741-guildworld/prototypes/headquarters/src/places.js, .ledger/history/202610171741-guildworld/prototypes/headquarters/generate_characters.sh

## symbol:PlaceScene.placeMinimap

The minimap is a Phaser camera placed `MINIMAP` (196) px square at 16 px from the top-right corner; its frame is the HTML `#minimap` in `index.html`, 208 px square at 10 px, whose 6 px border covers the camera's edges. Change one and the other must follow.
Why: the camera draws into the canvas and the frame is a separate DOM element with no layout link between them; a mismatch shows the place spilling past the frame or a gap inside it.
Coupled: .ledger/history/202610171741-guildworld/prototypes/headquarters/index.html
