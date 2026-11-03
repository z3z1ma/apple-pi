## symbol:CommunicationsApi

Catch-up `readThread` needs a stable UI attempt; recent and range inspections stay query-only. `react` adds or removes the operator's emoji and notifies nobody. `markRead` moves his read position to `seq` and never backward.
Why: inspection must not acknowledge unseen history, and a reaction is not a message. Moving a read cursor backward would reopen conversations he already finished.
Coupled: components/session-state/src/communication-types.ts, apps/agent-workplace/src/backend/communications.ts
Verify: apps/agent-workplace/tests/world-communications.test.ts
