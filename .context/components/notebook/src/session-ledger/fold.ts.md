## file

Fold valid notebook ledger entries from the branch root through the target entry, inclusive. Omit the target to fold through the branch tip.
Why: unknown custom entries, malformed notebook data and compaction details are ignored. Tombstoned observation and reflection ids stay listed even when the folded range has no matching record. Dropped and retired records remain in the first-valid sets; the live sets exclude them.
