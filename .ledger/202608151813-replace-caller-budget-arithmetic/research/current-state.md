Status: done
Created: 2026-08-15
Updated: 2026-08-15

# Current execution-budget ownership and failure semantics

## Question

Which execution limits are exposed to models and humans today, how are they enforced, and how can the harness retain hard ceilings without requiring callers to estimate tokens, turns, groups, memory, concurrency, and time?

## Sources

- `components/review/src/index.ts`
- `components/review/src/controller.ts`
- `components/review/src/types.ts`
- `components/ralph/src/index.ts`
- `components/ralph/src/controller.ts`
- `components/ralph/src/types.ts`
- `components/subagents/src/index.ts`
- `components/subagents/src/nested-tools.ts`
- `components/subagents/src/service.ts`
- `components/subagents/src/agent-runner.ts`
- `components/subagents/src/settings.ts`
- `extensions/runtime.ts`
- `docs/review.md`
- `docs/ralph.md`
- `README.md`

## Method

Traced every public TypeBox field, slash-command parser, configuration field, default normalizer, nested controller call, live usage callback, timeout, turn gate, and terminal classification. Cross-checked the fresh read-only Explorer report against the source.

## Findings

- Review exposes eight optional numeric controls to the model: aggregate tokens, timeout, concurrency, group count, three role turn limits, and prompt bytes. Defaults are 500,000 tokens, one hour, concurrency four, 32 groups, 12/25/15 role turns, and 384 KiB prompts.
- Ralph exposes six optional numeric controls to the model: iterations, aggregate tokens, timeout, and three role turn limits. Defaults are 10 iterations, 1,000,000 tokens, two hours, and 80/30/20 turns.
- Ralph passes its remaining aggregate token and time allowance into a nested ReviewController while also enforcing its own role and run ceilings. The distinction between run-wide, nested-run, and per-role controls is not visible in the model schema.
- The public Agent tool exposes optional `max_turns`; omission already means agent definition, trusted settings, or unlimited. ManagedSubagentService separately supports internal per-invocation token and hard-turn limits.
- Pi Exec exposes call count, host concurrency, worker memory, model-worker count, and timeout directly to the model. Omission applies fixed defaults of 128 calls, concurrency 16, 128 MiB, eight agents, and 300 seconds.
- Numeric omission is already supported everywhere. The bad experience comes from advertising implementation arithmetic as normal caller intent and from defaults that cannot adapt to known work size.
- Generic `aborted` or `steered` records are sometimes classified as budget exhaustion, and public subagent rendering labels every aborted agent as max-turn failure. Abort cause is therefore not preserved reliably across layers.
- Repository evidence establishes the defaults and failure paths but does not by itself prove that a specific default is too small. The operator reports premature model failures as the observed product problem; future receipts should provide workload-specific evidence.

## Conclusion

Remove numeric limit selection from ordinary model-facing schemas. Preserve cancellation, accounting, hard ceilings, internal ManagedSubagentService controls, and trusted human/config escape hatches. Let callers express semantic intent such as review profile while controllers derive limits from sealed work size and safety policy. Introduce explicit stop causes so operator cancellation, timeout, token ceiling, turn ceiling, compaction, provider failure, and authority failure remain distinguishable.

## Limits

No paid-provider run or production receipt corpus was analyzed. Adaptive formulas and compatibility policy require an active specification before implementation.
