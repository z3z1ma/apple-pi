---
name: human-review-ledger-task
description: "Present a ledger task bundle in the browser for approval. Use when a task's plan, specification, or tickets are ready for sign-off before implementation, or its outcome needs the user's review before closure."
---

# Present a Task for Sign-Off

`review_ledger_task` shows the whole undertaking: intent, documents, ticket graph, evidence. The page draws the graph; you set up the review so the user can judge the undertaking as a whole.

**Goal:** the user knows what they are approving, can judge it from the bundle alone, and the next action reflects their verdict.

## Frame the review

- **Name the boundary.** Two reviews exist: approve the plan and tickets before implementation, or confirm the outcome before closure. Say which one this is; the user reads differently for each.
- **Open at the right moment:** when everything the judgment needs is in the bundle. For a plan review, that is the spec and the tickets; for an outcome review, the evidence and the retrospective. A review of a half-written bundle costs a second review.
- **Orient in the conversation first.** One or two sentences: what the undertaking is, what state it is in, and what you need from them. Point at the document to read first if it is not `task.md`.
- **Use `note` for the ask**, in one sentence: "Approve the ticket order; ticket 4 is the risky one." A note that repeats the title is noise.
- **Honest confidence.** For a plan, say which decisions are settled and which are open. For an outcome, say what was proven, what was not, and what surprised.

## After the verdict

Apply the annotations and rewrites to the bundle yourself. Treat unread documents and graph warnings as limits on what the review established: an approval does not cover what the user never opened. Implementation and status changes follow the governing workflow and the scope of that approval.
