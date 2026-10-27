## symbol:compactInRequest

Subscription compaction uses inline context management rather than a dedicated compact operation. Its low trigger threshold can cause repeated compactions while an ordinary reply continues; a captured checkpoint is the operation's result, not a reason to wait for that reply. Cancel generation after the first complete compaction item and join the completion before returning. The internal cancellation may return an aborted message or reject; a fully captured checkpoint survives that cancellation. Caller cancellation still wins and prevents publication. The explicit compaction-trigger route keeps its normal completion behavior.
Why: a fixed-history live probe emitted five compaction items within one subscription request and continued until timeout; only the first complete checkpoint was needed.
Coupled: components/server-compaction/src/hooks.ts, docs/context.md
Verify: components/server-compaction/tests/providers.test.ts

## symbol:withCompactionFirst

Compaction items go first in a Responses `input`, both in the replay (`injectResponsesCompaction`) and in a chained compaction request (`compactInRequest`). The server drops every input item that precedes a compaction item.
Why: Pi 1.4 sends instructions as `developer` items and, for models with `supportsAdditionalTools`, the tool set as a leading `additional_tools` item (role `developer`), not top-level `tools`. Placing the items after the first developer-role item cut off the tool declarations on OpenAI (`gpt-6.1-sol` answered that it had no callable tools) and the system prompt on xAI. Live probes with the real models (a compacted session asked to run `bash` under a house rule) confirmed both losses and both recoveries.
Coupled: components/server-compaction/src/convert.ts, components/server-compaction/src/hooks.ts, docs/context.md
Verify: components/server-compaction/tests/replay.test.ts, components/server-compaction/tests/providers.test.ts
