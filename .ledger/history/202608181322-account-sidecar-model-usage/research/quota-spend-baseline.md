Status: active
Created: 2026-08-18
Updated: 2026-08-18

# Where model spend actually goes (measured baseline, 2026-08-18)

This record is the shared evidence base for the 2026-08-18 quota investigation. Four sibling
tasks reference it. It exists because the originating analysis lived only in a chat transcript.

## Question

The operator observed quota being consumed faster than comfortable and hypothesised the cause
was running four concurrent model processes over one trajectory (main agent, advisor, observer,
reflector, dropper), proposing to merge the sidecars into one. Is sidecar count the cost driver?

## Method

Every persisted Pi assistant message records `provider`, `model`, and `usage` including
`cost.total`. Aggregated all `~/.pi/agent/sessions/**/*.jsonl` (plus `reviews/` and `ralph/`,
which contain no assistant messages) with Python, grouping by model, by session, and by
per-call context size, where context size = `input + cacheRead + cacheWrite`.

Price-tier boundaries ("cliffs") were read from `~/.pi/agent/models-store.json` and
`~/.pi/agent/models.json` `cost.tiers[].inputTokensAbove`.

Scope limit: this measures only what Pi persists. See "What is invisible" below.

## Findings

### Lifetime totals

297 sessions, 14,211 assistant calls, **$1,625.45**, mean **$0.114/call**.

| provider/model | calls | input | cacheRead | output | $ | median ctx | p90 ctx |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `openai-codex/gpt-5.6-sol` | 6,998 | 30.4M | 1,221M | 3.24M | 1,110 | 172k | 319k |
| `xai/grok-4.6` | 4,472 | 27.6M | 518M | 3.85M | 414 | 115k | 222k |
| `openai-codex/gpt-5.6-terra` | 1,391 | 6.0M | 171M | 0.51M | 60 | 118k | 250k |
| `openai-codex/gpt-5.3-codex-spark` | 907 | 3.7M | 75M | 0.23M | 23 | 95k | 120k |
| anthropic (opus-4-6, sonnet-5, opus-5) | 204 | — | 24M | 0.16M | 17 | — | — |
| `openai-codex/gpt-5.6-luna` | 130 | 1.2M | 5.6M | 0.09M | **0.47** | 43k | 119k |

`gpt-5.6-sol` is 68% of lifetime spend, which explains the exhausted OpenAI subscription.

### Spend concentrates in long sessions, not in agent count

```text
top  1 session:  $814.22  (50.1%)
top  5 sessions: $1,127.66 (69.4%)
top 20 sessions: $1,361.13 (83.7%)
all child/worker sessions combined: $93.71 (5.8%)
```

Child/worker sessions were separated from root sessions by the presence of `om.*` or `advisory`
custom entries, which only the root context extension produces. Every subagent, review, and
Ralph iteration ever run totals 5.8% of spend, so delegation is not the driver.

The single $814.22 session (`sessions/--Users-alexanderbut-code_projects-work--/`,
`2026-08-15T02-36-45-326Z`) contains 4,793 assistant steps over 88.9 wall-clock hours, 33
compactions, `gpt-5.6-sol` 3,469 calls + `xai/grok-4.6` 1,324 calls, 872 `om.*` entries
(272 observations, 155 reflections, 396 drops, 49 retirements) and 217 advisories. Billed
context per call: **median 196k, p90 331k, max 372k**.

### The multiplier is context-per-step, and it is superlinear

| model | tier cliff | calls over cliff | tokens over | share of that model's spend |
| --- | --- | --- | --- | --- |
| `gpt-5.6-sol` | 272k (input $5→$10, cacheRead $0.50→$1.00) | 20% | 36% | **46%** |
| `xai/grok-4.6` | 200k (input $2→$4, cacheRead $0.50→$1.00) | 15% | 29% | **39%** |
| `gpt-5.6-terra` | 272k | 8% | 19% | 25% |

Pi's own documentation confirms the semantics: "Requests with more than 272K total input tokens
use GPT-5.6's long-context rates for the entire request"
(`node_modules/@earendil-works/pi-coding-agent/docs/models.md`, Per-model Overrides).

### Why billed context reaches 196k when the compaction gate is 81k

A unit mismatch, not a mis-tuned number.

- `components/memory/src/hooks/compaction-trigger.ts:33` gates on
  `rawTokensSinceLastCompaction(entries) >= resolveCompactAfterTokens(config, contextWindow)`.
- Active default is `compactAfterTokens: 81_000` with `compactAfterTokensMode: "calibrated"`
  (`components/memory/src/config.ts:50-51`), so the configured `contextWindow` is ignored
  entirely.
- `rawTokensSinceLastCompaction` → `rawTokensAfterIndex`
  (`components/memory/src/session-ledger/progress.ts:240-258`, `:13-15`) sums
  `estimateEntryTokens` only over entries in `SOURCE_ENTRY_TYPES` = `message`,
  `custom_message`, `branch_summary` (`progress.ts:11`), returning 0 for every other entry type
  (`components/memory/src/tokens.ts:26-48`).

The defect is structural exclusion, not estimator inaccuracy. For `type: "message"` entries,
which dominate, `estimateEntryTokens` delegates to Pi's own `estimateTokens`
(`components/memory/src/tokens.ts:26-29`); only `custom_message` and `branch_summary` use the
~4 chars/token approximation (`tokens.ts:3-5`, `:30-46`). What the gate never counts at all is:
the system prompt, tool schemas (this package ships `pi_exec`, `mcp`, `Agent`, `session_search`,
and ledger tools), the `compaction` entry itself (not a source type), and everything before
`firstKeptEntryId`. Those exclusions are fixed overhead the provider bills on every request, so
no amount of tightening the estimator closes the gap.

Meanwhile provider truth is already available in the same file:
`realTokensSinceCoverageIndex` / `realTokensSinceAnchor`
(`components/memory/src/session-ledger/progress.ts:225-248`) derive from
`ctx.getContextUsage().tokens`. The **consolidation** trigger uses that clock; the
**compaction** trigger does not. That asymmetry is the defect.

Ratio mode is not a fix on its own: `compactAfterTokensRatio: 0.68` multiplies the context
window but is still compared against estimated source tokens
(`components/memory/src/config.ts:73-78`).

### Sidecar cost, bounded structurally

The observational-memory trio is immaterial. Reflector and dropper each read only the folded
pool (`observationsPoolTargetTokens: 10_000`) and no transcript; the observer reads a delta
chunk capped at 20% of the memory model's window plus that pool. Their model's entire persisted
lifetime footprint across the install is **$0.47**, and none of those 130 calls are even the
memory agents (see below). Merging the trio restructures well under 1% of measured spend.

The advisor is structurally the worst-scaling sidecar, though unmeasured. It reviews on
`turn_end`, which Pi emits **per assistant step** rather than per user request
(`node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:455-464`;
`docs/extensions.md:576` — "one turn (one LLM response + tool calls)"), it re-sends its whole
accumulated history each review, and it self-compacts only at 80% of *its own* context window
(`ADVISOR_COMPACT_AT`, `components/advisor/src/extension.ts:1044`). That percentage-of-window
rule degrades as windows grow: ~160k on a 200k model, 400k on grok-4.6's 500k built-in window,
800k on a 1M model — the latter two sitting above their own price cliffs.

### What is invisible

Neither sidecar family has durable usage accounting, so **essentially 100% of the sidecar spend
under discussion cannot be measured today**:

- Observer, reflector, and dropper issue raw `agentLoop` calls, not Pi sessions, and record no
  usage anywhere. The 130 `gpt-5.6-luna` calls above come from other roles entirely.
- The advisor computes `usage` only in memory, per session
  (`components/advisor/src/extension.ts:487-504`), surfaced through `/advisor status` and the
  footer and lost on exit.

## Conclusions

1. Sidecar count is not the cost driver. Delegation is 5.8% of spend; the memory trio is under
   1%. The operator's merge hypothesis targets the cheapest processes.
2. The drivers are steps-per-session and billed-context-per-step on the primary trajectory,
   amplified superlinearly by provider long-context price tiers.
3. The compaction gate measures a quantity that is not the billed quantity, and ignores the
   configured context window, which is why context settles 2–4x above the intended bound.
4. The advisor is the one plausibly-large sidecar and is entirely unmeasured. Its
   percentage-of-window self-compaction rule is a latent defect that worsens as model windows
   grow.

## Limits

- Advisor and memory-agent spend are estimates from structure, not measurements. Every claim
  about them is `Not verified` until the sibling instrumentation task lands.
- Costs are Pi's own `usage.cost.total` figures, i.e. list-price attribution. They are a proxy
  for subscription quota consumption, not a billing statement.
- Model routing changed repeatedly over the measured period (the advisor ran `gpt-5.6-sol`,
  then `xai/grok-4.6`, then `claude-opus-5`), so per-model totals mix roles. Per-session model
  counts are recorded above where they mattered.
- One session dominates the aggregate; conclusions about typical sessions are weaker than
  conclusions about heavy ones.
