## file

Open the existing runtime database read-only and keep this probe observational; counts and payload lengths are separate from physical table/index storage.
Why: the runtime is the workplace database's only writer, and payload sums omit indexes, free pages and other columns. JSONL retention cannot be assessed by pretending previews are a full transcript backup or by equating payload bytes with database size.

The live main-file/WAL sizes and separate queries are point-in-time observations, not an atomic database-plus-filesystem snapshot.
Why: the runtime can append while the probe runs, and the report must not attribute small differences between observations to archival effects.
Coupled: components/session-state/src/schema.ts, .ledger/history/202611020022-long-lived-agent-recall-and-retention/evidence.md
