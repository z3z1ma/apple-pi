## file

`CONVERSATIONS`, `STREAMING`, and `QUESTIONNAIRES` are keyed by the seed session ids in `world.js` (`coord`, `a1`, `a2`, `a3`); the talk panel looks them up by `session.id`.
Why: nothing links the two files, so renaming a seed session or adding one silently gives it an empty conversation or no questionnaire form.
Coupled: .ledger/202610171741-guildworld/prototypes/headquarters/src/world.js, .ledger/202610171741-guildworld/prototypes/headquarters/src/talk.js
