## symbol:OrgMoveConfirm

Native modal containment does not isolate global key listeners. Escape is intercepted in window capture before the underlying PersonProfile's window bubble listener, and cancellation stays blocked while a reporting command is busy. Cleanup restores only a still-connected trigger; successful moves may remove the profile containing it.
Why: allowing Escape to bubble would close the profile beneath the confirmation, losing the operator's selection even when only the proposed move should be cancelled.

Refusal text belongs inside the active dialog via `error`, even when the parent also shows an alert.
Why: showModal makes the rest of the page inert; a refusal rendered only behind the dialog is not an accessible result of Confirm move.
Coupled: apps/agent-workplace/web/workplace-org.tsx, apps/agent-workplace/web/workplace-people.tsx, apps/agent-workplace/web/workplace-org-confirm.css
Verify: apps/agent-workplace/tests/world-org.test.ts
