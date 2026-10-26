# 12: Charge temporary peers' spend to their caller

Part of the approved spec [../spec.md](../spec.md); its Terms table defines window and the other words used here. Decided by the operator on 2026-10-26, after review of Compute counted by membership over time showed that fitness leaves out what `pi_exec` programs spend.

**What to build:** A temporary `pi_exec` peer's model spend counts as compute of the session that created it (its caller), at the time it was spent, before and after the program discards the peer. The runtime records each peer's caller when the peer is created, in a fact that disposal does not delete; when fitness rebuilds who reported to whom at a past moment, it uses that record as the discarded peer's manager. The history adapter charges a peer's `cost_changed` increases to that caller, under the caller's membership at that moment. The fitness result stops saying that compute excludes temporary peers.

**Blocked by:** 05 (Compute counted by membership over time).

**Status:** ready-for-agent

- [ ] Against a temporary state database built from real runtime event shapes, $3 spent by a temporary peer while its program runs appears as $3 of compute for its caller.
- [ ] After the program discards the peer, fitness for the same past window is unchanged.
- [ ] A peer created by a caller who was not a member of the organization at that time adds nothing to the organization's compute.
- [ ] The fitness result and tool text no longer name an exclusion of temporary peers' spend.
- [ ] A lasting member moved under a temporary peer, who spends while there, keeps that spend in the organization's past windows after the program discards the peer: the durable caller record also tells who the discarded peer reported to (review reproduction: the same window read $4 before disposal and $0 after).
