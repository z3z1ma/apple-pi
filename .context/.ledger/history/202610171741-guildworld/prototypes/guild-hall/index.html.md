## file

`LAYOUT.*.props[].i` indexes the props that `clean.py` cuts from `raw/codex/props.png` in reading order (rows, then left to right), and `PROP_TILES` in `clean.py` sizes them in the same order.
Why: regenerating `props.png` with a different arrangement silently swaps furniture (a globe where the table stood) without any error.
Coupled: .ledger/history/202610171741-guildworld/prototypes/guild-hall/clean.py

A station must sit at a larger y than the foot of any prop it stands behind, or the Y-sort hides the hero behind that prop.
Why: props and heroes are sorted on their foot point; the first layout put the Artificer and the Scribe fully behind the table and the beanbag.
