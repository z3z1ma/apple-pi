## file

Treat the physical suffix size as a sizing sketch, not an eligible archival cut; only individually stable files contribute to aggregate compression comparisons.
Why: the latest compaction's kept range can still depend on older settings, custom state, ancestry and other branches. Compression and the later raw read are separate passes, so an intervening append makes their byte counts incomparable.

This experiment discards compressed output and leaves original files intact. Lossless compression measures a smaller growth rate, not finite lifetime retention.
Why: the approved work is measurement and a proposal, not storage migration or a deletion policy.
Coupled: .ledger/202611020022-long-lived-agent-recall-and-retention/inventory.mjs, .ledger/202611020022-long-lived-agent-recall-and-retention/retention-probe.mjs, .ledger/202611020022-long-lived-agent-recall-and-retention/evidence.md
