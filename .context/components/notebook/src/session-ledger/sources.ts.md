## file

The child runner and its notebook-writing capability are gone, but existing primary-session JSONL records still contain `childSources`. Keep this decoder, its id mapping, and the persisted schema readable so those learnings retain exact source recall. New peers keep their own notebooks; this is an archive reader, not shared access for current colleagues.
Why: removing the producer must not sever citations already stored in the operator's notebooks.
Coupled: components/notebook/src/session-ledger/types.ts, components/pair-programmer/src/recall.ts
Verify: components/notebook/tests/notebook-maintenance.test.ts
