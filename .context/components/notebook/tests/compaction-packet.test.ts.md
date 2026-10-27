## file

The integration case records its learning through the public `update_notebook` tool and uses Pi's real native compactor with scripted model replies. Seeding a private notebook entry would bypass the recording path the operator depends on. Assert one persisted notebook packet per compaction and continuity through the next native summary and ordinary turn. A split-turn compaction may summarize the older history and the turn prefix separately, so provider-call count is not packet count.
Why: the native-only contract must preserve notebook delivery without reinstalling a custom compactor; a fixed reply queue hid Pi's second summarization request. Projected packets have role `custom`, while persisted entries use top-level type `custom_message` and `customType`.
Coupled: components/notebook/src/hooks/compaction-packet.ts, components/notebook/src/notebook-maintenance.ts, tests/helpers/faux-session.ts
Verify: components/notebook/tests/compaction-packet.test.ts
