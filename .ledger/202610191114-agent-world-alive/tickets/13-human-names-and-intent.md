# 13: Human names and stated intent

**What to build:** Sessions are named like people, and what they are working on comes from elsewhere (operator, 2026-10-19).
- **Names:** the session-title extension stops writing adjective-noun or topic titles. An unnamed root TUI session gets a random, memorable two-part human name (a first name and a family name, drawn from varied cultures, playful but believable) as soon as it starts, unique among live sessions, kept across resumes. A rename from `/name`, Agent World, or elsewhere still wins for good.
- **Intent:** when a session has no ledger task, its intent comes from the session itself: after each settled user turn, the `quick` model writes one short sentence of what the session is doing now (or keeps the previous one when the work has not changed). The bridge reports it as a new session fact, `intent`, which the runtime stores in a new column with its own change events (a forward migration). Views show the ledger task when there is one, else the intent: Agent World's conversation panel, examine card, side-panel rows, and Work tab; the tmux sidebar and dashboard where they show a task.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] A new unnamed root TUI session is named at start with two parts that come from the name lists, different from every other live session's name (faux-session test).
- [ ] No session-title model request is made to choose a name; a name set by `/name` is never replaced.
- [ ] After a settled user turn, the session's `intent` fact holds the quick model's sentence (faux model), is stored by the runtime with an `intent_changed` event, and is unchanged when the model answers that the work has not changed.
- [ ] Agent World shows the ledger task when there is one and the intent otherwise, in the panel, card, rows, and Work tab; the sidebar does the same.
- [ ] `docs/context.md` (Session titles) and `docs/session-state.md` describe the new behaviour.
