## symbol:interior

Every raw room must be generated with a plain dark backdrop around the room that reaches all four image corners. The prompts ask for a "dark navy background around the room".
Why: the crop flood-fills from the four corners to find the backdrop. In a full-bleed generation the corners are room pixels, so the fill spreads into the room and the crop shrinks or finds nothing.

The crop takes the lowest clear rectangle, so the front edge of the floor is at the bottom of every cropped room.
Why: `FLOOR` in `room.html` stands the workers at fixed fractions of the room height (front row at 0.95). A crop placed higher would stand them on the wall.
Coupled: .ledger/202610160838-notch-agent-room/prototype/web/room.html

## symbol:worker_frames

Worker sheets must not put magenta-hued props (285–315°) on the worker. Purple props, such as a wheelchair frame, stay.
Why: the background key removes every saturated pixel in that hue band, not only the flat `#FF00FF` backdrop. The band covers the darker magenta shadows that generations draw under desks.

## symbol:recolor

Worker sheets must show a blue shirt with hair that is not blue. The prompts say "bright blue t-shirt" or "blue vest".
Why: the 6 `SHIRT_HUES` variants move only blue pixels with enough saturation and value. A shirt of another colour gets no variants, and blue hair would change colour with the shirt.
