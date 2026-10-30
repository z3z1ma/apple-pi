## file

Mount the native discovery/creation dialog beside the Chat sidebar, rather than within it: the sidebar's broad descendant button/heading rules otherwise stretch Close/Add and collapse the recipient input even in the top layer. Discovery retrieves metadata only; opening a listed channel selects its ordinary retained Chat reader, while creation requires the operator to choose the recorded organization scope explicitly. Scope choices come from current lasting organization heads, including people at home. Native-agent automatic scope and operator selection are intentionally different contracts.

A submitted creation keeps its UUID and canonical form fields for this renderer lifetime, including after uncertain completion and dialog disposal. Status checks use that exact identity. A not_recorded result is not proof a disconnected request cannot arrive: preparing a fresh creation requires explicit duplicate-risk acknowledgment and never submits it automatically. Discovery pages retain the original query/filter/size for continuation.
Why: topic names are presentation, not unique addresses, so silently retrying a creation could produce a second independent channel with the same label.
Coupled: apps/agent-world/web/workplace.tsx, apps/agent-world/web/workplace-communications.tsx, apps/agent-world/src/communications.ts
Verify: apps/agent-world/tests/world-communications.test.ts
