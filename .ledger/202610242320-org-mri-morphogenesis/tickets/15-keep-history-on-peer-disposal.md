# 15: Keep what history needs when temporary peers are discarded

Part of the approved spec [../spec.md](../spec.md); its Terms table defines window and the other words used here. Decided by the operator on 2026-10-26, after review of Compute counted by membership over time showed that fitness leaves out what `pi_exec` programs spend.

**What to build:** A temporary `pi_exec` peer's model spend counts as compute of the session that created it (its caller), at the time it was spent, before and after the program discards the peer. The runtime records each peer's caller when the peer is created, in a fact that disposal does not delete; when fitness rebuilds who reported to whom at a past moment, it uses that record as the discarded peer's manager. The history adapter charges a peer's `cost_changed` increases to that caller, under the caller's membership at that moment. The fitness result stops saying that compute excludes temporary peers.

Disposal of a temporary peer must also keep the facts that past windows read: its assignments on tasks that survive the disposal end (they are not deleted), so a lasting task's delay keeps its in-progress spans.

**Blocked by:** 11 (Fitness as one tool among the others).

**Status:** ready-for-agent

- [ ] Against a temporary state database built from real runtime event shapes, $3 spent by a temporary peer while its program runs appears as $3 of compute for its caller.
- [ ] After the program discards the peer, fitness for the same past window is unchanged.
- [ ] A peer created by a caller who was not a member of the organization at that time adds nothing to the organization's compute.
- [ ] The fitness result and tool text no longer name an exclusion of temporary peers' spend.
- [ ] A lasting member moved under a temporary peer, who spends while there, keeps that spend in the organization's past windows after the program discards the peer: the durable caller record also tells who the discarded peer reported to (review reproduction: the same window read $4 before disposal and $0 after).
- [ ] A lasting ledger task worked by a temporary peer from hour 0 shows $5 of in-progress delay for hours 0 to 1, and still does after the program discards the peer at hour 2 (review reproduction: it turned into queued delay); the peer's assignment is ended, not deleted.
- [ ] The durable record also keeps that the session was a temporary peer: a peer that was moved inside the organization, spent, and opened a question adds nothing of its own (its spend goes to its caller, its question is not a member's) both before and after disposal (review reproduction: compute $0 and 0 interruptions turned into $5 and 1 after disposal).
- [ ] A temporary peer's questions to the operator and its messages in mail threads the operator is in count as its caller's interruptions, under the caller's membership at that moment, before and after disposal.
