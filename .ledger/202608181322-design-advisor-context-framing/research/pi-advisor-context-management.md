Status: active
Created: 2026-08-18
Updated: 2026-08-18

# How pi-advisor v0.3.0 manages advisor context

## Question

Our advisor accumulates turn deltas into one long-lived private conversation and self-compacts at
80% of its own context window. The operator wants a design that (a) preserves user intent across
a turn's kickoff message and all subsequent steering messages, (b) carries rolled summaries and
recent nudges forward, and (c) uses an anchored frame rather than a sliding tail so prompt cache
reads survive. Has the reference implementation solved any of this, and is anything adoptable?

## Method

Read the local checkout at `/tmp/apple-pi-pi-advisor-review`, commit
`366b534bf2becd39c2899ca6a2d370230fc2a235` (2026-08-15), package `@ribbons-digital/pi-advisor`
v0.3.0, MIT licensed, remote https://github.com/ribbons-digital/pi-advisor.git. The public GitHub
repository returned 404 to anonymous API access on 2026-08-18, so this local clone is the only
available source. Read `src/transcript.ts`, `persistence.ts`, `config.ts`, `delivery.ts`,
`advice.ts`, targeted regions of `src/runtime.ts` (3,669 lines, grepped rather than read whole),
plus `tests/` and `docs/`. No code was copied.

## Findings

**Two stores, not one.** The advisor's own model conversation is a live in-memory nested
`AgentSession` that accumulates across reviews (`src/runtime.ts:2698-2703`, `:1818-1872`), while
the *executor evidence* for each review is rebuilt from scratch from a cursor over the Pi host
session branch (`src/runtime.ts:2116-2169`). That split is close to ours: we also accumulate
private history and feed per-turn deltas.

**Selection is a newest-first byte tail, not a frame.** `renderBoundedEntries` walks entries
newest→oldest and keeps a tail until `maxUpdateTokens * 4` bytes, prepending a truncation marker
(`src/transcript.ts:201-260`, `:12-15`). Defaults: `context.maxUpdateTokens` 24_000,
`limits.maxPendingTranscriptBytes` 200_000, `limits.maxReprimeTokens` 32_000,
`MAX_ADVISOR_TOOL_RESULT_BYTES` 64 KiB (`src/config.ts:180-186, 205-216`).

**Their context limit has the same percentage-of-window shape as ours, and therefore the same
scaling defect.** `advisorContextLimit = floor(model.contextWindow * context.maxFraction) -
context.reserveTokens`, defaults `maxFraction` 0.65 and `reserveTokens` 8_192
(`src/runtime.ts:834-838`; `src/config.ts:181-185`). More conservative than our 80%, but still a
fraction of whatever window the model advertises, so on a 1M-window model it authorises ~650k of
private history. **The reference does not solve the problem the operator raised.**

**User intent is preserved instructionally, not structurally.** The system prompt asserts that
the latest explicit user request controls workflow and that summaries are subordinate evidence
(`src/runtime.ts:854-859`, pinned by `tests/integration/current-evidence-policy.test.ts`). The
serializer emits every user entry identically as `[Executor user]` with **no distinction between
the message that started a turn and later steering messages** (`src/transcript.ts:157-160`), and
there is no pin, always-include, or re-injection: a user message older than the byte budget is
simply dropped. Tests assert only that the *newest* user text survives truncation
(`tests/unit/advisor-policy.test.ts:705-709`). A user/steering distinction exists solely for
delivery routing (`branchHasNewerInstructionInput`, `src/transcript.ts:66-85`), never for prompt
assembly. This is precisely the gap the operator identified.

**No advisor-authored summaries.** Private-history compression is delegated to Pi's
`session.compact(...)` with a preservation instruction (`src/runtime.ts:2491-2494`); automatic
nested compaction is disabled (`:1809-1811`). If compaction fails or the estimate is still over,
private messages are cleared outright and the current update is retried once against empty
history (`:2437-2453`, `:2517-2521`). Lifecycle re-prime is a deterministic redacted tail of the
host branch since the last compaction, not a model summary (`:1177-1210`;
`src/transcript.ts:443-454`). There is no rolling window-summary mechanism of the kind the
operator sketched.

**Prior nudges are not re-injected.** Past advice survives only incidentally inside nested
history until compact/wipe/restart; advisor notes are explicitly stripped from executor deltas
(`src/transcript.ts:163-164`, asserted at `tests/unit/advisor-policy.test.ts:1076`). What
persists across restarts is a bounded set of 128 dedupe hashes for repeat suppression
(`src/persistence.ts:16`), not note text. Our hold-and-reconfirm preamble, which re-offers live
concerns and blockers to the next review, is a stronger mechanism than anything here.

**No prompt-caching design, and one active anti-pattern.** No comment, identifier, or test in
`src/` or `docs/` refers to stable prefixes, cache breakpoints, or cache-friendly ordering.
Cache tokens appear only in usage accounting (`src/runtime.ts:237-238`). Notably, project context
and memory-suggestion policy are **prepended to every update user message** rather than placed in
the system prompt (`:2354-2373`, `:2614-2619`), and changing captured project files clears nested
messages (`:2610-2613`) — both hostile to a frozen cacheable prefix. Any cache hits they get are
accidental.

**Budget exhaustion path.** Estimate via `estimateAdvisorContext` (`src/runtime.ts:298-332`),
then: send as-is → `session.compact` → wipe private messages → if the single current update still
does not fit, drop that update and stay active (`:2465-2526`). Plus separate governors: max 4
advisor turns and 8 tool calls per update, optional lifetime token/cost soft caps that pause the
advisor, and a three-consecutive-failure pause (`src/config.ts:207-215`; `src/runtime.ts:110`,
`:3410-3428`).

## Conclusion

Nothing here is adoptable for the operator's three goals. On context selection the reference is a
newest-first byte tail with a percentage-of-window private budget — structurally the same family
as our current design, with the same growth-with-window defect and no intent pinning, no rolled
summaries, and no caching intent. The operator's sketch (pinned turn-kickoff plus all steering
messages, rolled window summaries, retained recent nudges, anchored frame for cache reuse) is
more sophisticated than the reference on every axis he named.

Two things are worth taking as *negative* evidence rather than design input: a fraction-of-window
budget is what a comparable implementation independently chose, so departing from it needs a
stated rationale; and their willingness to drop an update entirely rather than degrade silently
is a defensible failure boundary worth mirroring.

Their governors — per-update turn and tool-call caps, and pausing after repeated failure — are
orthogonal to context framing but are reasonable prior art if we later want advisor cost ceilings.

## Limits

- Single-session code reading of one pinned commit; no execution of their test suite, no live
  install, no runtime measurement of their cache behaviour.
- `src/runtime.ts` was grepped, not read in full, so a context mechanism not matching the search
  terms could have been missed.
- Pi internals behind `AgentSession.compact` and `estimateContextTokens` were not investigated,
  so claims stop at this package's boundary.
- Upstream is inaccessible anonymously as of 2026-08-18; findings cannot currently be refreshed
  against a newer commit.
