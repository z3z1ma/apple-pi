## file

Seed a worker's `reports-to` flag in the extension factory before installing the bridge. Rebinding exercises preservation of the admitted reporting line, rather than creating that line. Keep the supervisor close-notice and reload-silence assertions intact.
Why: the runtime owns reporting after first admission and correctly ignores a later startup flag. A close/reload failure reproduced before the observation changes; changing admission setup repaired the fixture without weakening its behavioral contract.

The stopped-session replay case scopes command receipts to kind='mail' and checks zero model requests before the explicit resume prompt. Startup may include other legitimate harness commands, including authored team context; replayed mail belongs to nextTurn rather than an unsolicited model turn. These are separate from the model's eventual understanding of the mail.
Why: asserting that every command for the reopened session was the one queued mail rejected legitimate startup traffic. Receipt delivery alone also failed to establish that startup stayed quiet. The Org runtime suite separately verifies goal-free team context, identity and absence of invented work.
Coupled: components/session-state/src/mail.ts, components/session-state/src/bridge.ts, components/session-state/src/runtime.ts, apps/agent-world/tests/org-runtime.test.ts
Verify: components/session-state/tests/mail.test.ts, apps/agent-world/tests/org-runtime.test.ts
