## file

The operator's UI UUID is mapped into the shared caller-scoped command journal. Look up the original input/operation before creating another operation; a stored effect outranks a lost socket receipt. Status is observational and accepts either the returned handle or original UI UUID. No record after a transport failure remains uncertain, not a safe resend claim.

Recent/range reads are query-only and never create acknowledgments. Catch-up requires a stable attempt and returns the runtime's stored original page and acknowledgment, even on retry after new messages arrive. A returned page may carry a failed acknowledgment; preserve that distinction rather than replacing readable content with success or discarding it as a transport error.

The backend extracts each operation's fields and fixes kind/version/actor. Renderer properties cannot become a runtime command. New semantics require the communication schema; an older daemon is refused rather than quietly dropping fields. Legacy World APIs remain available for its retained renderer, while Workplace uses this richer surface.

Coupled: apps/agent-world/src/communications.ts, apps/agent-world/src/electron/communications-ipc.ts, components/session-state/src/communication.ts, components/session-state/src/communication-actions.ts
Verify: apps/agent-world/tests/communications-backend.test.ts
