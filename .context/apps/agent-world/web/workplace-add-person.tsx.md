## file

Add person is the immediate single-person lifecycle path, separate from planned team startup. Blank names are intentional for valid role hires and use native automatic naming; role, repository and goal stay explicit.

Optional specialization describes a focus within the chosen role. Keep it separate from the goal and from the person's Self profile; preserve it through refused or pending submissions under the same form lock. Send a trimmed value only when nonblank.
Why: the runtime records specialization as creation-time person metadata, while the goal becomes an assignment. Combining them would lose that distinction on later tasks or retries.

A recruit receipt is not proof of connection unless its stage is applied and it names a session. Accepted/delivered receipts hold the returned identity and await that exact awake snapshot entry. A thrown IPC result is uncertain, freezes repeat submission and retains the fields. A failed receipt with a session ID can also have saved a provisional person and goal; it retains that identity for inspection instead of offering another hire. Preflight refusals without an ID remain editable. Closing while the request is in flight is disabled. The optional onBusyChange callback lets Org prevent chart/profile navigation from discarding the in-flight form; it reports false only when the request settles. The parent owns selection/profile navigation through onCreated; this form never reads conversations or acknowledges messages.
Why: another recruit call creates another identity and assignment; retrying an unconfirmed start can duplicate a real person.
Coupled: apps/agent-world/web/workplace-org.tsx, apps/agent-world/src/backend/lifecycle.ts
Verify: apps/agent-world/tests/add-person.test.ts, apps/agent-world/tests/world-org.test.ts
