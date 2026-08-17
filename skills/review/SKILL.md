---
name: review
description: "Review a code change by writing a pi_exec program. Use for pull-request review, patch review, or checking a working tree. Load this skill and author a fresh program from the references; do not rebuild a review controller."
---

# Review

Review is a `pi_exec` program you write for this change. There is no review extension, no `/review` command, and no sealed-tree controller.

Load this skill. Read the reference that matches the job. Write a **new** program. Adapt it. Then run it.

```javascript
// Tool arguments — not guest code
{
  code: "<the program>",
  display: { name: "Review", description: "Plan, review, verify this change." },
  inputs: { paths: "src/foo.ts\nsrc/foo.test.ts", background: "Why this change exists." },
  limits: { agentBudget: 32, callBudget: 256, concurrency: 8, timeoutSeconds: 1800 },
}
```

`limits` is a `pi_exec` parameter, not a guest assignment. Set `agentBudget` to at least planner + reviewers + verifier (and another cycle if you will loop). Raise `callBudget` when the program does more host work than the default.

## Spine

Keep this shape. Vary the filters, packet, and whether you loop.

1. **Discover** the files that matter. Prefer `inputs.paths`. Otherwise one `pi.bash` git status/diff, or the files already in context. Skip binaries and `.ledger/` as subjects.
2. **Plan** with one worker. Typed partitions of files + concrete focuses (question + a couple of checks). Cycle 1 covers every selected file.
3. **Fan out** one read-only worker per focus with `parallel` / `agents.run`. Cap concurrency if you want. Findings are patch-introduced, assigned-path, evidenced. Notes are fine.
4. **Verify** with one worker over the pile. Decide each finding. Write sentiment, compound risks, residuals, coverage gaps.
5. **Optionally loop** when residuals or uncovered files remain. Later planners must not repeat the same investigation.
6. **Return** a compact receipt: files, focuses, findings, decisions, sentiment, residuals, gaps, failures.

JavaScript owns scheduling, coverage, and whether to loop. Models only emit typed values. Never `JSON.parse` assistant text.

## Workers

- Tools: `read`, `grep`, `find`, `ls` only.
- Role prompts: read `skills/review-planner/SKILL.md`, `skills/reviewer/SKILL.md`, `skills/review-verifier/SKILL.md` and pass the bodies as `systemPrompt`.
- Bind **paths**, not file bodies. Context is capped.
- Workers have no extensions or skills. They return through `pi_exec_return` / `outputSchema`.

## References

- [Plan, review, verify](references/plan-review-verify.js) — default cycle for an unknown change.
- [Targeted review](references/targeted-review.js) — skip the planner when the question is already known.

Write a variation when the change asks for one: a second residual pass, a tests-only lens, a security pass, a wider concurrency cap. Do not grow a second review product. Do not reintroduce sealing, leases, receipts stores, or coverage machinery in TypeScript.

## Purpose

Falsify the change. Report only defects the patch introduced. Leave residuals and gaps visible. Prefer a small honest program over a complete-looking one.
