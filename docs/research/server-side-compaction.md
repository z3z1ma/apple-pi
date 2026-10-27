# Server-side compaction: provider support and evidence

Researched 2026-10-02 for the question: should Apple Pi replace the xAI-only compaction hook with one generic extension that forces server-side compaction on every capable provider? The provider survey below is historical; the implementation was removed on 2026-10-27. See [Decision](#decision) and the current [context contract](../context.md).

## Provider support

| Provider | Mechanism | Output | Can we guide it? | Source |
| --- | --- | --- | --- | --- |
| OpenAI Responses | In-band: `context_management: [{type: "compaction", compact_threshold}]` on `POST /responses`. Standalone: `POST /responses/compact`. | Opaque encrypted `compaction` item, "not intended to be human-interpretable". Carries prior state and reasoning. Works with `store: false`, so it suits zero data retention. | Standalone accepts `instructions` (a system/developer message), not a summary prompt. | [OpenAI compaction guide](https://developers.openai.com/api/docs/guides/compaction.md) |
| Anthropic Messages | On demand: beta `compact-2026-09-04`, `"compaction": {"type": "summarize"}`. Threshold: `context_management` edit (separate page and beta). Cannot combine both on one request. | A `compaction` block whose summary is readable text, plus a signature. Must be sent back unchanged. | Yes. A custom summarization prompt replaces the default one. | [Compaction overview](https://platform.claude.com/docs/en/build-with-claude/compaction.md), [Compaction on demand](https://platform.claude.com/docs/en/build-with-claude/compaction-on-demand.md) |
| xAI Responses | `POST /v1/responses/compact`. | Opaque encrypted item. "Only meaningful when sent back to xAI's API." | No guidance parameter documented. | [xAI context compaction](https://docs.x.ai/developers/advanced-api-usage/context-compaction.md) |
| Google Gemini | None found for `generateContent`. Only the Live API has sliding-window compression. | — | — | **Not verified** against a primary page; search summary only. |

Anthropic on-demand compaction lists Claude API, Claude Platform on AWS, Google Cloud and Microsoft Foundry as beta. Amazon Bedrock is "not available". Supported models include Opus 4.6 and later and Sonnet 4.6 and later.

Every server-side item is valid only on the provider that made it. A session that changes provider after compaction needs a readable fallback. The former Apple Pi xAI hook stored a text projection for that reason; the current package uses Pi's readable summaries instead.

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

### Original decision (superseded)

On 2026-10-02 the owner chose server-side compaction for OpenAI, xAI, and Anthropic, with Pi's summarizer as the fallback elsewhere. That implementation has since been removed. Live probes with OAuth credentials confirmed that each provider compacts and that a later request recalls compacted facts from the server result alone. OpenAI follows Codex (`codex-rs/core/src/compact_remote_v2*.rs`): an ordinary Responses request ending in a `compaction_trigger` item. The `openai` provider's ChatGPT subscription sign-in on api.openai.com refused both `/responses/compact` (`hardened_oauth_rule_missing`) and `compaction_trigger` (`subscription_sharing_unsupported_capability`); Codex sign-in uses the ChatGPT backend instead.

### Removal decision: 2026-10-27

A controlled same-history comparison on the installed OpenAI subscription route measured 127,898 input tokens after the native checkpoint versus 80,071 after Pi's ordinary summary, with the same model, live instructions/tools and retained tail. Input changes reduced the fresh-checkpoint excess but did not repair an existing opaque chain. This is one measured case, not a universal compression ratio or a decoding of the checkpoint.

The owner required exact Codex parity for Pi's `openai` provider with ChatGPT OAuth, otherwise Pi's native LLM summarization everywhere. The compatibility check failed: [pinned Codex](https://github.com/openai/codex/blob/c8e73bf7198152ecc1158b148105d054add7a525/codex-rs/model-provider-info/src/lib.rs#L457-L475) routes ChatGPT auth through `chatgpt.com/backend-api/codex/responses` with bearer and account headers, while installed Pi 1.4's `openai` OAuth requests a direct-use token for `api.openai.com/v1`. Codex's remote V2 appends an explicit compaction trigger and requires one completed checkpoint; our subscription threshold-and-abort workaround was a different protocol. The route difference does not, by itself, prove the backend's reason for rejecting the trigger.

The package therefore removes custom compaction requests, opaque replay, text projections, pair compaction overrides and provider-specific retention machinery. All providers use Pi's native LLM summarizer. The independent post-compaction notebook packet and automatic-compaction failure safety remain. No authentication rerouting, deprecated-provider switch or new summarization platform is introduced.
