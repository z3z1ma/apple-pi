## file

Observe read acknowledgment through the returned `readUpTo`, returned post sequences, and public operator inbox counts. An operator post preserves the last explicit-read cursor; an unrelated private post creates a global sequence gap. Private-thread refusal is checked by the public workplace reader as well as the membership receipt.
Why: posting is not reading earlier messages, and subtracting unread counts gives the wrong boundary across global sequence gaps. Direct participant-table assertions would tie this bridge test to storage rather than prove that a caller can use the returned boundary and still cannot access private mail.
Coupled: apps/agent-world/src/backend/mail.ts, apps/agent-world/src/backend/workplace.ts, components/session-state/src/threads.ts
Verify: apps/agent-world/tests/channel-membership.test.ts
