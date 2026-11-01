## file

The batch dialog is embedded under Org while also using shared person-dialog styles. Keep its heading/actions outside the bounded scroll body and keep its option labels specific enough to override both style owners regardless of load order.
Why: inherited Org form styles previously stacked radio labels and pushed the heading above the viewport even though the dialog bounds and click tests passed. The operator must be able to read the confirmation and reach its actions at the same time.

Coupled: apps/agent-world/web/workplace-departures.tsx, apps/agent-world/web/workplace-org.css, apps/agent-world/web/workplace-person-actions.css
Verify: apps/agent-world/tests/world-lifecycle.test.ts
