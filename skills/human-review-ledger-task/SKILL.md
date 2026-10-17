---
name: human-review-ledger-task
description: "Present a ledger task bundle in the browser for approval. Use when a task's plan, specification, or tickets are ready for sign-off before implementation, or its outcome needs the user's review before closure."
---

# Present a Task for Sign-Off

Use `review_ledger_task` at a human approval boundary for a ledger undertaking. Open the bundle so the user can judge its intent, documents, ticket dependencies, and evidence together.

- Put the material to review in the bundle first, including tickets when the proposed work has been split into tickets.
- Pass the task id or bundle path as `task`; select another project with `cwd`. Call the tool from the root session.
- Use `note` for the judgment needed now, such as approving scope and sequencing or checking the completed outcome.
- Wait for the verdict, then apply returned annotations and rewrites to the bundle yourself. Treat unread documents and unresolved graph warnings as limits on what the review established.

Success means the user can judge the undertaking as a whole and the next action reflects their verdict. Implementation and ledger status changes follow the governing workflow and the scope of that approval.
