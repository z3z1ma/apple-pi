## file

The pair is an internal SDK conversation, not another root extension host. Its source-grounded initial seed is supplied by PairRuntime in extension.ts; subsequent compaction belongs to Pi's native LLM summarizer over the pair's own conversation. Registering a custom reseed or provider-checkpoint replay hook here would silently restore the removed alternative compaction policy. The primary notebook's postcompact packet remains owned by the main session, not this loader.

Copy the effective compaction settings object rather than the model-resolved getCompactionSettings() result: the latter drops modelOverrides. The selected pair model must still resolve its own ordinary/trusted-project settings through Pi, including the native defaults when no settings are present.

Coupled: components/pair-programmer/src/extension.ts, components/pair-programmer/src/seed.ts
Verify: components/pair-programmer/tests/native-compaction.test.ts, components/pair-programmer/tests/pair.test.mjs
