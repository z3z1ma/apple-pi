## file

This repository-local guard catches the exact bare `position.ready` argument to `useSeenConversation`, including parentheses and whitespace. The panel can remain mounted and focused while an inline browser page hides its transcript, so read-position readiness alone is insufficient for acknowledgment.

Compound readiness expressions, including stronger or equivalent visibility gates, remain outside this narrow prohibition. The rule does not analyze aliases or prove an arbitrary predicate includes visibility. Its policy samples validate registration; built-reader hidden-reply/return tests validate the behavior.
Why: a blanket requirement for one boolean spelling would constrain valid implementations, while a direct bare-readiness regression is mechanically recognizable.
Coupled: .pi/rules/policy.json, apps/agent-workplace/web/overlay/conversation/conversation-panel.tsx
Verify: lint/repo-rules.mjs, apps/agent-workplace/tests/world-conversation.test.ts
