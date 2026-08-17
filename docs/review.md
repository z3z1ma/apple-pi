# Review

Review is a skill over `pi_exec`, not an extension. Load `/skill:pi-review`, write a program from the packaged references, and set `limits` so planner + reviewers + verifier fit. Role prompts live in the review skill references and are copied into `systemPrompt` constants. Leave those workers untyped; do not set `type` to `Counsel` or `Plan`. Workers return typed values through `pi_exec_return`.

```text
/skill:pi-review
```

The default spine is plan focuses → fan-out read-only reviewers → one verifier → optional residual loop. Vary the program when the change asks for it. Findings must name a patch-introduced cause in an assigned path.

See [`skills/pi-review`](../skills/pi-review) for the procedure and [`docs/exec.md`](exec.md) for the guest runtime.
