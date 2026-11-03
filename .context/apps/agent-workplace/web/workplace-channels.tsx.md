## file

Mount the native discovery/creation dialog beside the Chat sidebar, rather than within it: the sidebar's broad descendant button/heading rules otherwise stretch Close/Add and collapse the recipient input even in the top layer. Discovery retrieves metadata only; opening a listed channel selects its ordinary retained Chat reader, while creation requires the operator to choose the recorded organization scope explicitly. Scope choices come from current lasting organization heads, including people at home. Native-agent automatic scope and operator selection are intentionally different contracts.

A submitted creation keeps its UUID and canonical form fields for this renderer lifetime, including after uncertain completion and dialog disposal. Status checks use that exact identity. A not_recorded result is not proof a disconnected request cannot arrive: preparing a fresh creation requires explicit duplicate-risk acknowledgment and never submits it automatically. Discovery searches again as the operator types or changes a filter (a short pause, the newest request wins), in pages of 50; More channels continues with the original query and filters.
Why: topic names are presentation, not unique addresses, so silently retrying a creation could produce a second independent channel with the same label.
Coupled: apps/agent-workplace/web/workplace.tsx, apps/agent-workplace/web/workplace-communications.tsx, apps/agent-workplace/src/communications.ts
Verify: apps/agent-workplace/tests/world-communications.test.ts
