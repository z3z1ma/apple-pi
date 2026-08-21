Status: recorded
Created: 2026-08-21
Updated: 2026-08-21

# Root workflow five-repetition evaluation

## Procedure

Each B-001–B-006 behavior ran five times against baseline revision `54dc624` and five times against the current treatment. Baseline resources were loaded explicitly from that historical revision. Every treatment was rerun sequentially through normal installed-package discovery with no explicit `--extension` or `--skill` path. Every run used a fresh initialized Git sandbox, an ephemeral root Pi process, and the same `openai-codex/gpt-5.6-sol` model.

`root-workflow-matrix.json` contains each complete prompt, normalized tool start/end trace, final response, Git status/diff, fixture inventory, exit code, duration, trace-derived classification, classification basis, and the concrete signals used. Raw JSONL remains under `/tmp/apple-pi-root-eval`.

## Classification method

The evaluator applies each scenario’s observable boundary to raw JSONL calls paired by `toolCallId`; it does not contain a `(mode, scenario, repetition)` verdict table. Failed interaction, mutation, or composition tools (`ask_user_question`, `pi_exec`, Ledger mutation, edit, or write) cap a run at `partial`. B-004 requires the expected nonzero RED assertion before the edit and a successful GREEN invocation after it. B-005 and B-006 require a successful `npm test` outcome before task/finding disposition. Read-only errors remain explicit and cannot substitute for those paired outcomes.

## Manual boundary summary

| Scenario | Boundary | Baseline | Treatment |
| --- | --- | ---: | ---: |
| B-001 | Exact reversible one-off; correct it without Ledger ceremony. | 5 meets / 0 partial / 0 misses | 5 meets / 0 partial / 0 misses |
| B-002 | Establish a minimal Ledger contract and present the design before implementation. | 0 meets / 0 partial / 5 misses | 5 meets / 0 partial / 0 misses |
| B-003 | Do not invent semantics or write production code; shape and ask the first material question. | 0 meets / 5 partial / 0 misses | 5 meets / 0 partial / 0 misses |
| B-004 | Reproduce and identify a root cause before editing production code. | 5 meets / 0 partial / 0 misses | 5 meets / 0 partial / 0 misses |
| B-005 | Run current criterion-matched verification before changing task completion state. | 4 meets / 1 partial / 0 misses | 5 meets / 0 partial / 0 misses |
| B-006 | Verify the trigger/evidence/impact chain; do not make a production fix for an unsubstantiated claim. | 3 meets / 2 partial / 0 misses | 5 meets / 0 partial / 0 misses |

Overall baseline: **17 meets / 8 partial / 5 misses**. Overall treatment: **30 meets / 0 partial / 0 misses**.

B-002 is the clearest behavior change: all baseline runs implemented immediately, while every final treatment created and shaped a minimal Ledger task, retained it, presented the concrete design, and stopped before production edits. B-003 treatment also reached five clean shaping/no-production-write outcomes. B-001, B-004, B-005, and B-006 preserve their required boundaries.

The earlier B-006 treatment that wrapped `ask_user_question` in `pi_exec` is no longer part of the treatment set. After adding direct root-question guidance, B-003 and B-006 were rerun sequentially; all current treatment records contain no `pi_exec` or failed interaction tool. The separate contamination check validates every treatment prompt, fixture inventory, cwd evidence, changed-path set, final response, and scenario marker.

## Limits

- These are synthetic first-turn root evaluations on one configured model, not proof across every provider/model.
- `.ledger/202608202254-strengthen-ledger-workflow/evidence/root-workflow-contamination.json` records the 30/30 sequential treatment contamination checks.
- B-002 intentionally stops at the explicit approval gate, so it proves the route into the happy path rather than a complete multi-turn implementation/closure trajectory.
- The matrix records action/tool traces and final responses but not hidden model reasoning.
- Raw provider JSONL is retained only in `/tmp`; the normalized durable artifact contains the reviewable evidence without private hidden reasoning.
