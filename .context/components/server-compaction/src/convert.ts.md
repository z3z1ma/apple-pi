## file

The xAI compact endpoint does not pass through Pi's live Responses adapter. Run the public pi-ai transformMessages policy with the actual destination model after convertToLlm and before formatting its input. That shared policy decides which assistant reasoning can replay by provider/API/model identity, and also owns ordinary message replay normalization; JSON-parsable thinkingSignature alone proves no compatibility. Keep that policy in the SDK instead of adding local identity rules or forwarding foreign readable thinking as visible text.
Why: the former endpoint formatter replayed foreign encrypted reasoning that a live request would drop, even though the assistant's visible text remained usable. This is a compact-endpoint mismatch, not evidence for a separate OpenAI repeated-compaction cause. The endpoint wire formatter and its existing tool-ID handling remain local; this change does not claim every wire field is identical to the live adapter.

Previous compacted output items are opaque server results, prepended separately from ordinary Pi messages. The model-aware pass acts on messages, not on those output items or their chaining/replay authority.
Coupled: components/server-compaction/src/responses.ts, components/server-compaction/src/types.ts, components/server-compaction/src/hooks.ts
Verify: components/server-compaction/tests/convert.test.ts, components/server-compaction/tests/providers.test.ts, components/server-compaction/tests/replay.test.ts
