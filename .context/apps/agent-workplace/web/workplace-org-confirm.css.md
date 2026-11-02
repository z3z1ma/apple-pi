## file

The modal remains a DOM descendant of Workplace while the browser paints it in the top layer. It inherits Workplace's appearance variables and shared primary-button styling; its backdrop is native rather than the old positioned confirmation veil.
Why: moving the component outside the Workplace theme owner or reusing the old full-screen veil styles would lose the palette or distort native dialog sizing. Refusal alerts must remain readable within the modal, not on the inert page behind it.
Coupled: apps/agent-workplace/web/workplace-org-confirm.tsx, apps/agent-workplace/web/workplace-org.css, apps/agent-workplace/web/workplace.css
Verify: apps/agent-workplace/tests/world-org.test.ts
