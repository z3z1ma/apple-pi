## file

Only original `message` records consume historical message ordinals, including off-lineage messages. Added custom-message, summary and notebook sources use their original entry IDs; the rendered and raw arrays stay position-aligned after filtering.

Why: old `#N`, file-payload and notebook citations outlive compaction and branch selection. Counting newly searchable record kinds, or renumbering the filtered branch, redirects those citations to different evidence.

Preceding input describes ancestry or legacy chronology, not the originating question. Notifications and learning packets can occupy that position.

Why: the transcript records delivery order, not proof that one input caused a later assertion.

Coupled: components/session-search/src/tool.ts, components/session-search/src/drill-down.ts, components/session-search/src/search-entries.ts
Verify: components/session-search/tests/source-recall.test.ts, components/session-search/tests/load-messages.test.ts
