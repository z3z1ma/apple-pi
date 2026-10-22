## file

A program request is a run in this person's existing Pi session, not mail and not a second session. It enters as a custom message so goal text cannot execute slash commands or prompt templates. The queue waits for Pi to be idle; cancellation names one request and leaves unrelated work alone. Runtime disconnection fails queued requests and aborts only the program-owned active run, because its waiting caller can no longer receive a result.

Start queued work outside `agent_settled`: it is notification-only, and `isIdle` remains false while its handlers run. The delayed drain rechecks idle instead of relying on a single settlement callback. Session replacement and tree navigation invalidate requests, rather than attributing a later session's reply to them.

The structured-return tool exists only for a schema-bearing run and is hidden before the result is returned. Preserve other tools activated during that run; restoring an old whole-tool snapshot would undo legitimate MCP discovery.

Coupled: components/session-state/src/bridge.ts, components/shared/src/turn-observer.ts, components/shared/src/structured-output.ts
Verify: components/session-state/tests/peer-turns.test.ts
