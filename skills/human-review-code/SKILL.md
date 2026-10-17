---
name: human-review-code
description: "Present a code change in the browser for the user's judgment. Use when the user wants to inspect a diff, approve your implementation, or decide code-level trade-offs, and at a completed implementation handoff that needs their review."
---

# Present a Code Review

Use `review_code` to let the user judge the real diff, with your reasoning beside it. Open it at the review handoff and use the returned verdict to guide what happens next.

Choose a coherent change ready for judgment. For a request to audit correctness or find defects yourself, use the separate `code-review` skill; this page serves the human review that follows when needed.

- Select the target repository with `cwd` and the comparison with `base`. Call the tool from the root session, including for another worktree.
- Tell the story in reasoning order: the core change, its consequences, then supporting tests and docs. Point to the few places where the user's attention matters most.
- State what verification proved and what remains uncertain. Put genuine choices in `decisions` and explain the trade-offs.
- Wait for the verdict, then address the returned comments and choices. Report any requested change that remains unresolved.

Success means the user can judge the change and their verdict guides the next action. The tool supplies the diff and reports anything your story leaves unplaced.
