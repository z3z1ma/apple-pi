## file

World integration panels use the Atlassian singleton for opening links. Workplace supplies onLink through its existing window bridge; omitting the callback preserves World's current link behavior. Both consumers share the same safeHtml/textHtml rendering boundary.
Why: Workplace loads separately and does not initialize World's place controller. Using that singleton there would leave sanitized links without a connected opener. The callback changes only link dispatch, not which HTML is allowed.

Coupled: apps/agent-world/web/overlay/places/rich-text.ts, apps/agent-world/web/overlay/places/atlassian-state.ts, apps/agent-world/web/workplace-issues.tsx
Verify: apps/agent-world/tests/world-quest-library.test.ts, apps/agent-world/tests/world-issues.test.ts
