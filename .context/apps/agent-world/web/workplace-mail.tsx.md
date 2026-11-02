## file

Inbox rows are one per conversation from the operator inbox summary (last author, preview, participants, kind). Sent and Activity group the per-recipient delivery records of one message into one row: a thread post's delivery id is `<post id>:<recipient>`, so the suffix is stripped to group, and each recipient keeps its own state in the reader. Activity's badge counts messages newer than the last time the operator opened Activity, kept in localStorage.
Why: the runtime records one delivery per recipient, which made a message to three people show three times.

The inbox is split into People and Updates: a conversation goes under Updates only when Pi (`harness`) wrote its latest message and no other person takes part, so departures and notices stop burying mail from people; a summary without participants counts as People. Activity's count is a quiet number, not a badge: the delivery log is not a queue the operator must clear.
Verify: apps/agent-world/tests/world-desk.test.ts

## symbol:Compose

The existing single-recipient, fixed-subject form submits through communications.sendMail with a renderer-allocated attempt UUID retained before the request. Its canonical recipient/body survive uncertain outcomes and closing/reopening the form. Outcome recovery uses the same UUID; it never constructs another thread. A fresh send after not_recorded requires explicit duplicate-risk acknowledgment and preserves the draft without sending it automatically. Applied results clear only the matching saved body and report actual audience/queued state separately from acknowledgment. Legacy World sendMail remains a separate consumer and is intentionally unchanged here.
Coupled: apps/agent-world/src/communications.ts, apps/agent-world/src/backend/communications.ts, apps/agent-world/web/workplace.tsx
Verify: apps/agent-world/tests/world-communications.test.ts
