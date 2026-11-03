## file

Array-edit payload extraction participates in ordinary history search as well as file-only search and exact payload recovery.

Clipping uses UTF-16 offsets. Keep the high-surrogate boundary guard so a shortened recall passage remains valid Unicode rather than ending with half of an astral character.

Why: file-only retrieval previously found replacement text that default history discovery omitted. Keeping the write/edit argument interpretation shared prevents one recall route from silently becoming a smaller evidence corpus.

Coupled: components/session-search/src/search-entries.ts, components/session-search/src/drill-down.ts
Verify: components/session-search/tests/source-recall.test.ts, components/session-search/tests/content.test.ts
