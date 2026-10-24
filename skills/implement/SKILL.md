---
name: implement
description: "Implement decided work from a ticket, small specification, or plan settled in the current conversation, with TDD, a review board, the operator's sign-off, and an authorized commit."
disable-model-invocation: true
---

# Implement

Build the work the operator already decided, from a ticket, a small specification, or a plan settled in this conversation. Restate the behavior you will build, then build it without reopening the plan. Use judgment for small discoveries; report a missing or contradictory product or design decision as a blocker instead of redesigning the work.

## Select the work

- Read the whole ticket or specification. Confirm the ticket's title, and check its blockers against the canonical ticket state or the operator's word; report an incomplete or unknown blocker instead of picking other work. A ticket made stale by a changed specification waits for regeneration.
- One run builds one ticket or one small specification. Work that spans fresh contexts goes to `/skill:to-tickets` first.
- Record the working tree's staged, unstaged, and untracked state before you edit. Preserve every pre-existing change; ask before touching a dirty path you cannot keep apart.

## Staff it

Build one coherent ticket yourself. When the operator selects several frontier tickets that are independent and write different files, run them in parallel: give each to a standing `implementation-engineer` (find one in the directory with matching experience, call them in, or hire one) with its whole ticket, its seams, and exclusive ownership of its files. You lead: engineers report in their task threads, and you reconcile, run the final suite, and own review and the commit. Serialize any two lanes that turn out to touch the same files.

## Build test-first

Read and apply [`tdd`](../tdd/SKILL.md) where the behavior has observable input and output. Use the test seams the specification or ticket confirmed; for a seam nobody confirmed, propose it with what it catches and misses, and ask the operator with `ask_user_question` before writing that test. Where TDD does not fit, say why and follow the repository's test rules.

Run typechecking and focused tests as you go, and the repository's full required suite once at the end. The final suite runs on the final code.

## Review and sign-off

Read and apply [`code-review`](../code-review/SKILL.md) on the working tree against `HEAD`, scoped to this work and its intent source. Fix the confirmed findings this run needs; report the rest.

Then, for a substantial change, read and apply [`operator-sign-off`](../operator-sign-off/SKILL.md) for a code sign-off before committing. Skip it when the operator waived sign-off for this run, for example for unattended overnight work, and say in the report that you did.

## Finish

Commit to the current branch only when the operator authorized a commit for this run; otherwise leave the change commit-ready and say so. Ticket state, pushes, pull requests, and anything beyond the commit need their own authorization. With a failed check, a blocker, or an unresolved in-scope finding, keep the partial work and report it as incomplete.

Report the work built, changed paths and lane owners, seams with red → green evidence, check and suite results, review findings and fixes, the sign-off verdict or its waiver, and the commit or its absence.
