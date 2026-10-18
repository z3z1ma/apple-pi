## symbol:SHEETS

Asset names are matched to each raw sheet's pieces in reading order, and they are the texture keys the scene uses (`HOUSES`, `WINGS`, hub keys in `HUBS`, prop names).
Why: a regenerated sheet with a different object order silently swaps sprites; `clean.py` only warns when the piece count differs.
Coupled: .ledger/202610171741-guildworld/prototypes/town/src/scene.js, .ledger/202610171741-guildworld/prototypes/town/src/layout.js
