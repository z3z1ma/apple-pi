# Server-side compaction: provider support and evidence

Researched 2026-10-02 for the question: should Apple Pi replace the xAI-only compaction hook with one generic extension that forces server-side compaction on every capable provider?

## Provider support

| Provider | Mechanism | Output | Can we guide it? | Source |
| --- | --- | --- | --- | --- |
| OpenAI Responses | In-band: `context_management: [{type: "compaction", compact_threshold}]` on `POST /responses`. Standalone: `POST /responses/compact`. | Opaque encrypted `compaction` item, "not intended to be human-interpretable". Carries prior state and reasoning. Works with `store: false`, so it suits zero data retention. | Standalone accepts `instructions` (a system/developer message), not a summary prompt. | [OpenAI compaction guide](https://developers.openai.com/api/docs/guides/compaction.md) |
| Anthropic Messages | On demand: beta `compact-2026-09-04`, `"compaction": {"type": "summarize"}`. Threshold: `context_management` edit (separate page and beta). Cannot combine both on one request. | A `compaction` block whose summary is readable text, plus a signature. Must be sent back unchanged. | Yes. A custom summarization prompt replaces the default one. | [Compaction overview](https://platform.claude.com/docs/en/build-with-claude/compaction.md), [Compaction on demand](https://platform.claude.com/docs/en/build-with-claude/compaction-on-demand.md) |
| xAI Responses | `POST /v1/responses/compact`. | Opaque encrypted item. "Only meaningful when sent back to xAI's API." | No guidance parameter documented. | [xAI context compaction](https://docs.x.ai/developers/advanced-api-usage/context-compaction.md) |
| Google Gemini | None found for `generateContent`. Only the Live API has sliding-window compression. | — | — | **Not verified** against a primary page; search summary only. |

Anthropic on-demand compaction lists Claude API, Claude Platform on AWS, Google Cloud and Microsoft Foundry as beta. Amazon Bedrock is "not available". Supported models include Opus 4.6 and later and Sonnet 4.6 and later.

Every server-side item is valid only on the provider that made it. A session that changes provider after compaction needs a readable fallback. Apple Pi's xAI hook ([`docs/context.md`](../context.md)) already stores a text projection for that reason.

## What Pi's default summarizer already does

Pi 1.0.0 `core/compaction/compaction.js`:

- Uses a fixed structured format: Goal, Constraints & Preferences, Progress (Done / In Progress / Blocked), Key Decisions, Next Steps, Critical Context.
- On later compactions it updates the previous summary (`UPDATE_SUMMARIZATION_PROMPT` with `<previous-summary>`) instead of starting over.
- Computes read and modified file lists from tool calls (`computeFileLists`) instead of asking the model to remember them.
- Accepts `customInstructions`, appended as "Additional focus".

## Quality evidence

Only one head-to-head comparison was found: [Factory, "Evaluating Context Compression for AI Agents"](https://factory.ai/news/evaluating-compression) (2025-12-16).

- Data: over 36,000 messages from production software engineering sessions. After each compression, probes ask about facts, files, next steps, and decisions. GPT-5.2 grades answers 0–5.
- Methods: OpenAI `/responses/compact`; Anthropic's Claude SDK compaction (a full summary regenerated each time, client side, not the server API above); Factory's structured summary that is updated incrementally.

| Method | Overall | Accuracy | Context | Artifacts | Continuity | Tokens removed |
| --- | --- | --- | --- | --- | --- | --- |
| Factory (structured, incremental) | 3.70 | 4.04 | 4.01 | 2.45 | 3.80 | 98.6% |
| Anthropic SDK (regenerated summary) | 3.44 | 3.74 | 3.56 | 2.33 | 3.67 | 98.7% |
| OpenAI `/responses/compact` (opaque) | 3.35 | 3.43 | 3.64 | 2.19 | 3.77 | 99.3% |

Limits: Factory sells the winning method; one LLM judge; no task-completion measure; the Anthropic server API was not tested; models and endpoints have changed since.

Vendor claims for server-side compaction are about cost, latency, longer sessions, and carrying reasoning forward. No vendor page found reports a quality comparison against a client-side summary.

## Conclusions

1. The evidence does not show server-side compaction is better for coding-agent continuity. The one comparison ranks the opaque OpenAI item last. Pi's default summarizer shares the main features of the top-ranked method (fixed sections, incremental update), but neither Pi's summarizer nor Anthropic's server-side compaction API was tested.
2. Server-side compaction has real advantages that the comparison does not measure: encrypted reasoning carried forward (OpenAI, xAI) and valid preserved thinking for kept turns (Anthropic signed blocks).
3. Opaque items (OpenAI, xAI) cannot be read or checked, and accept little or no guidance on what to keep. On those providers the only readable continuity is a bounded text projection of the compacted history and the [notebook packet](../context.md#pair-programmer-notebook). Anthropic's readable summary with a custom prompt avoids this.
4. Forcing server-side compaction on every capable provider is not supported by evidence.

## Decision

On 2026-10-02 the owner chose server-side compaction for OpenAI, xAI, and Anthropic, with Pi's summarizer as the fallback elsewhere. [`docs/context.md`](../context.md) describes the implementation. Live probes with OAuth credentials confirmed that each provider compacts and that a later request recalls compacted facts from the server result alone. OpenAI follows Codex (`codex-rs/core/src/compact_remote_v2*.rs`): an ordinary Responses request ending in a `compaction_trigger` item. The `openai` provider's ChatGPT subscription sign-in on api.openai.com refused both `/responses/compact` (`hardened_oauth_rule_missing`) and `compaction_trigger` (`subscription_sharing_unsupported_capability`); Codex sign-in uses the ChatGPT backend instead.

A measured comparison on real sessions, as described in the conclusions, has not been run.
