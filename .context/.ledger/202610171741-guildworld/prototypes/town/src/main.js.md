## file

The game is created with `input: { windowEvents: false }`.
Why: Phaser otherwise reads pointer-up from the whole window, so a click on the HTML controls or inspector also hit the world object under it (pressing a control button opened the Library).
Coupled: .ledger/202610171741-guildworld/prototypes/town/src/scene.js

The coordinator picked under "workers report to" lives in `picked`, not in the `<select>`.
Why: every state change re-renders the control panel, which rebuilt the select and silently sent new workers to the first coordinator.
