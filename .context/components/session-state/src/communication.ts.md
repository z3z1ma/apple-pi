## file

Shared queries run in plain Node for native tools and Workplace. Access is rechecked from current membership; channel access rows include unjoined scope readers. `participants` means joined people, while `invitations` also retains unfollowed grants. Temporary identities acquire topic/organization access only explicitly, even when their reporting line lies inside the branch.

Continuation tokens describe a query and its original message window; they grant no authority and every page rechecks access. Their effective view is returned in the page. Catch-up rejects a position beyond the current confirmed cursor, so a fabricated recent/range continuation cannot skip unread messages. Its caller must use that returned view, not an omitted/default request field, when deciding whether to acknowledge.

Attempt lookup precedes alias resolution or new thread IDs at both native and World boundaries. The existing commands row stores the canonical operation and original effect; a same-attempt read returns that frozen page and acknowledgment rather than a new window. New wire kind/version and the schema capability check make unsupported callers/runtime fail visibly instead of silently dropping notification/access fields.
Coupled: components/session-state/src/communication-actions.ts, components/session-state/src/communication-types.ts, components/session-state/src/communication-tools.ts, components/session-state/src/runtime.ts, apps/agent-world/src/backend/communications.ts
Verify: components/session-state/tests/communication-core.test.ts, components/session-state/tests/communication-tools.test.ts
