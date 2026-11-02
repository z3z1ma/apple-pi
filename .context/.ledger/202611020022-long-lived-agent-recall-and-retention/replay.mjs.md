## file

Keep historical eligibility separate from the deployed-path diagnostic: the former excludes the whole issuing assistant entry, while the latter includes it; both exclude future entries and respect requested ancestry.
Why: the issuing entry contains the query itself and can rank highly without supplying prior evidence. Comparing a prototype against future or differently scoped evidence would leak answers into the measurement.

Subsequent navigation is only a behavioral proxy, not relevance gold. Full-tool timing follows parsing of the same file and is warm-filesystem timing.
Why: an agent can expand the wrong index, and a first timed invocation after a read is not a cold-start trial. These distinctions determine which claims the report can support.
Coupled: .ledger/202611020022-long-lived-agent-recall-and-retention/inventory.mjs, .ledger/202611020022-long-lived-agent-recall-and-retention/gold-replay.mjs, .ledger/202611020022-long-lived-agent-recall-and-retention/evidence.md, components/session-search/src/search-entries.ts
