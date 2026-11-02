## file

Use direct read-only JSONL parsing for the research corpus rather than Pi's session-opening helpers.
Why: the inspected Pi 1.4.0 loader can append a missing newline, and opening legacy sessions can migrate/rewrite them; an apparently convenient native reader would violate the inquiry's read-only authorization.

The private inventory is the input manifest for replay and storage measurements. Preserve opaque file keys and keep actual paths outside Git; record parse failures rather than treating filtered records as a verified archive.
Why: the published aggregates must remain traceable without publishing private transcripts, and tolerated malformed lines are not evidence of lossless storage.
Coupled: .ledger/history/202611020022-long-lived-agent-recall-and-retention/replay.mjs, .ledger/history/202611020022-long-lived-agent-recall-and-retention/storage.mjs, .ledger/history/202611020022-long-lived-agent-recall-and-retention/evidence.md
