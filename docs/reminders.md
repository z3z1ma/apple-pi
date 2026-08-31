# Self-reminders

`remind_me` is the default one-shot continuation tool. Call it with one model-authored `message` when a follow-up belongs after the current run rather than in the current trajectory.

Calls made during one run are queued in call order. When the run settles, apple-pi clears that batch and sends one visible `followUp` message that starts the next turn. The injected message identifies the items as the model's own deferred notes, not new operator authority, and requires reassessment against the latest direction and repository state.

The queue is in memory only. It is cleared before delivery and on session start, forking, tree navigation, session switching, and shutdown. An empty queue emits nothing. It has no IDs, editing, persistence, status, dependencies, schedules, recurrence, or ambient cadence.
