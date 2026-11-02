Status: research complete; proposal awaiting approval
Created: 2026-11-02
Updated: 2026-11-02

# Retrospective

## What mattered

Two independent investigations separated retrieval quality from retention integrity. The all-session inventory and current-code historical-prefix replay were kept distinct from a project-scoped, manually labeled historical audit. Six real questions had 30% top-five entry precision but only two sufficient displayed answers; exact navigation was more useful than broad discovery. The result does not establish product-wide accuracy.

The cheapest prototype, excluding the issuing search entry, removed two irrelevant hits but replaced them with two others. It produced no measured precision, episode-recall or snippet-sufficiency gain on the frozen gold. Preserving that negative result prevented a convenient mechanism from becoming an unsupported solution claim.

## Learnings

- Source existence, source support, evidence displayed and evidence used are different. A structurally successful notebook lookup had unrelated sources. An agent attributed a loss to compaction even though its active summary still contained the checklist.
- Transcript byte size is a poor proxy for long-lived work. The initial size-biased audit was retained transparently and supplemented with compaction-depth sampling.
- A compaction boundary is not a storage collection boundary. Naive truncation loses live kept messages, settings, custom state, mail replay deduplication, citations and index continuity.
- The installed Pi loader can append a missing newline and migration can rewrite originals. Read-only research must parse JSONL directly. This hazard and its source evidence live in retention-investigation.md.
- Hot-memory bounds, compressed cold storage and finite total retention are separate promises. Lossless archiving alone cannot stop lifetime growth.

## Improvements and remaining decisions

The ranked proposal starts with extraction/addressing and visible evidence, then query semantics, then incremental retrieval and a Pi-owned storage prototype. No production change or archival operation ran. Future comparison must keep frozen cutoffs, labels and negative cases, independently judge novel hits, and distinguish warm filesystem timing from cold startup/RSS.

Private gold and mappings remain outside the repository in documented temporary directories; those can disappear, so exact manual-label reproduction depends on retaining them privately or relabeling originals. Operator approval, native-storage integration, fault testing, actual long-horizon behavior and finite total-state retention remain open.
