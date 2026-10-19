## file

The cat strip's frame size (41 x 58, printed as `cat frame` when the script runs) is hard-coded in `src/main.js`'s `load.spritesheet("cat", ...)`.
Why: the strip carries no metadata, unlike the character strips with `assets/chars/manifest.json`; regenerating `raw-art/cat.png` changes the size, and a stale value in `main.js` slices the strip into wrong frames without any error.
Coupled: .ledger/history/202610171741-guildworld/prototypes/headquarters/src/main.js
