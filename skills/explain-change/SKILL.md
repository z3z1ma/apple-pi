---
name: explain-change
description: "Explain a code change through a browser walkthrough with real code and a quiz. Use when the user asks to understand a commit, branch, pull request, or implementation, and after a substantial change they need to understand well enough to build on."
---

# Explain a Change

Use `explain_change` when the handoff calls for understanding: what changed, why it changed, and how the pieces work together. Open the explanation as part of the answer, alongside a short summary in the conversation. For an approval verdict, use `review_code` instead.

- Ground the explanation in the originating intent, surrounding code, and tests. Choose the few ideas the user needs to retain.
- Teach the idea with a concrete example before walking through real code. Use the quiz to check those ideas, and organize the walkthrough around how the change works.
- Cite repository-root paths with empty `code path:FROM-TO` fences. The tool supplies the code; its guidance defines line and revision semantics.
- Call from the root session. Set `cwd` for the target repository or worktree; use `base` and `head` for historical changes. Present a different checkout directly by selecting its directory.
- Share the returned page address and saved artifact. The tool returns immediately; use subsequent reader feedback to close gaps before building on the change.

Success means the user can reason about the change and continue from it. If the page cannot open, explain the change in your reply and state the concrete obstacle while still delivering a useful answer.
