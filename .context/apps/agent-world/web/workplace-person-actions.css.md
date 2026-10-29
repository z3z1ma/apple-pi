## file

Person ellipsis controls remain named native buttons with visible borders at rest, including in the existing DM/profile header layouts. Scope their treatment and the profile-action grouping to these controls, rather than resetting all header buttons or changing profile Close.

The lifecycle modal stays within Workplace's themed DOM while the native top layer supplies containment. Its dimensions/overflow follow the existing reporting-confirmation treatment, retain every affected person/outcome without a result cap, and keep refusal/warning text inside the modal. Pending controls are visibly disabled; the component's synchronous lock, not styling, owns request/cancel safety.
Why: native top-layer placement keeps DOM theme inheritance but makes the page behind the modal inert. Moving the dialog outside Workplace or rendering refusals only behind it would lose the palette or hide the actionable result. Scoped button styling preserves the existing header controls while keeping the new ellipsis recognizable at rest.
Coupled: apps/agent-world/web/workplace-person-actions.tsx, apps/agent-world/web/workplace.css, apps/agent-world/web/workplace-org.css
Verify: apps/agent-world/tests/world-lifecycle.test.ts
