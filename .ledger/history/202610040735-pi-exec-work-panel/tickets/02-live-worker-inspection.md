# 02: Inspect live model-worker tools

**What to build:** Let the operator inspect a program-owned model worker's active tools before that worker finishes. Keep worker identity, task, current activity, tool outcomes, and failures associated with the correct worker and program during parallel execution. Extend the program inspection from ticket 01 without treating these workers as public subagents or adding steer, resume, or independent cancellation controls. Follow the parent [specification](../spec.md) and its confirmed automated execution-to-panel and real fullscreen Pi test seams. Before writing or editing tests, obtain fresh confirmation of those seams for this implementation.

**Blocked by:** [01 — Inspect program invocations and host calls](01-program-inspection.md).

**Status:** done

**Completion:** `0165591`. Closed by operator request; the task outcome records validation results and the unresolved full-suite cancellation-test failure.

- [x] While two named model workers are still running in one program, the operator can select each worker and inspect its supplied name and task plus current thinking/tool activity. Their detail remains distinguishable instead of being merged into one program-wide activity string.
- [x] A controlled worker that starts a tool and pauses before completing it exposes that active child tool in the Pi Exec tab before the worker returns. The operator can inspect its tool identity and relevant trace-safe target; a final-only trace does not satisfy this behavior.
- [x] When parallel worker tool events interleave, active tools and completed tool outcomes appear only under the worker that issued them. Tool success and failure update that worker's detail while the program remains active, and those outcomes remain inspectable after settlement.
- [x] When `agent_run` returns a failed worker status and the script handles it and succeeds, inspection shows both the successful outer outcome and the failed worker with its available error. The worker failure is not concealed by a successful host-call return.
- [x] Aborting or timing out an active worker-owning program leaves inspectable terminal worker/tool detail rather than an indefinitely running child row. Updates arriving after the owning context changes cannot recreate that old worker detail in the current tab.
- [x] Live and settled worker detail observes the existing trace disclosure boundaries: bound context and schema payloads deliberately omitted from traces remain omitted. Inspectable worker tool activity stays under its program rather than joining the public Agents roster, and its view offers no public-agent control actions.
- [x] Automated execution-to-panel checks prove live child-tool visibility before completion, parallel ownership correlation, handled worker failure, terminal cleanup, and redaction. Existing worker results, nested final traces, usage accounting, and cancellation regressions still have recorded passing outcomes or separately identified pre-existing failures.
- [x] A real fullscreen Pi check demonstrates selecting a running worker and reading its child-tool activity before settlement, then inspecting its final detail. Relevant formatting/lint, typecheck, package-loading/inclusion checks have recorded outcomes, and the Pi Exec documentation describes live worker inspection and its ownership limits.
