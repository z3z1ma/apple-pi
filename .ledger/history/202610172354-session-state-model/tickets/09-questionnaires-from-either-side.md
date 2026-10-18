# 09: Questionnaires from either side

**What to build:** `ask_user_question` publishes its open questionnaire through the bridge and accepts an answer from the terminal or from an answer command, whichever arrives first; the other side then closes.

**Blocked by:** 08 Command channel

**Status:** done

- [x] With a questionnaire open in a faux session, an answer command returns those answers to the tool, the tool result matches answers given in the terminal for the same choices, and the receipt reaches applied.
- [x] When the terminal answers first, a later answer command fails with a reason, and the prompt is cleared in the database.
- [x] When the answer command arrives first, the terminal dialog closes.
- [x] Other extensions' select, confirm, and input dialogs still work only in the terminal.
