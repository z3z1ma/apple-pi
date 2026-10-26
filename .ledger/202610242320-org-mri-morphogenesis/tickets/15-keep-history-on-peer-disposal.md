# 15: Keep what history needs when temporary peers are discarded

Part of the approved spec [../spec.md](../spec.md); its Terms table defines window and the other words used here. Decided by the operator on 2026-10-26, after review of Compute counted by membership over time showed that fitness leaves out what `pi_exec` programs spend.

**What to build:** A temporary `pi_exec` peer is a program-owned session that is discarded after its work. Its caller is the session that created it. Charge the peer's recorded model spend to its first lasting caller, following nested creation ancestry exactly once, both before and after disposal. Place spend at the time the runtime observed it; this is not exact spend timing during an outage. Judge the caller's organization membership at that observation.

The runtime records the caller and temporary identity durably at creation. That record supplies the peer's initial reporting relationship when reconstructing history; recorded moves still govern later reporting relationships. Accounting ownership remains the immutable caller chain, separate from reporting moves. Replace the blanket temporary-spend exclusion with supported caller attribution and explicit remaining legacy limits.

Disposal of a temporary peer must also keep the facts that past windows read: its assignments on tasks that survive the disposal end (they are not deleted), so a lasting task's delay keeps its in-progress spans.

**Blocked by:** 11 (Fitness as one tool among the others).

**Status:** done (committed ebb54f5b after scoped review and operator approval; live rollout remains separate)

## Accepted implementation conventions

Follow [the accepted producer/reader plan](../peer-history-implementation-notes.md). Accounting follows immutable creation ancestry recursively to the first lasting caller exactly once; structural reporting changes remain authoritative for historical ancestry and are not an accounting-owner alias. Spend is placed at runtime observation time, including outage/reconnect convention. New peer creation records launch ownership, durable caller/temporary identity and a zero cost baseline atomically before launch; existing/legacy sessions do not receive invented zero baselines. Migration may preserve observed surviving caller mappings, not fabricate lost callers, births or spans.

Questions and operator mail/escalations count for the caller: question events follow recorded event sequence; mail uses membership at its message timestamp, including same-timestamp joins. Durable temporary classification prevents a deleted/moved peer from becoming an ordinary member. Retained-task assignments end without becoming completed; actual internal-task deletion remains allowed, including sequential disposal of its temporary holders. Existing retained task posts/work_changes and operator threads already survive; preserve them rather than adding duplicate stores. Emit standard transferred history for disposal reparenting. Unknown legacy history remains a disclosed limit, not complete recovery.

## Acceptance checks

- [x] Against a temporary state database built from real runtime event shapes, $3 spent by a temporary peer while its program runs appears as $3 of compute for its caller.
- [x] After the program discards the peer, fitness for the same past window is unchanged.
- [x] A peer created by a caller who was not a member of the organization at that time adds nothing to the organization's compute.
- [x] The fitness result and tool text no longer claim a blanket exclusion of temporary peers' spend; distinguish genuinely unknown legacy provenance from the newly supported attribution.
- [x] A lasting member moved under a temporary peer, who spends while there, keeps that spend in the organization's past windows after the program discards the peer: the durable caller record also tells who the discarded peer reported to (review reproduction: the same window read $4 before disposal and $0 after).
- [x] A lasting ledger task worked by a temporary peer from hour 0 shows $5 of in-progress delay for hours 0 to 1, and still does after the program discards the peer at hour 2 (review reproduction: it turned into queued delay); the peer's assignment is ended, not deleted.
- [x] Durable classification keeps a moved/discarded peer temporary, never an ordinary member. Compute and operator questions belong to its caller exactly once before and after disposal, not to a newly inferred lasting peer. The old failing reproduction changed from excluded compute $0 / interruptions 0 to peer-owned compute $5 / interruptions 1 after deletion; the repair is stable caller attribution, not retaining that exclusion.
- [x] A temporary peer's questions to the operator and its messages in mail threads the operator is in count as its caller's interruptions, under the caller's membership at that moment, before and after disposal.

## Closure evidence

Final Standards/Intent report `t-f093a35f` cleared thirteen paths after three significant finding families were repaired:

- Failed file removal after sequential disposal now keeps the current departing peer's launch ownership until cleanup can be retried.
- A later caller observation or manager snapshot no longer supplies an earlier unknown caller or reporting relationship.
- The bridge's hello handshake now rejects an ordinary transcript resume that would reactivate a discarded temporary identity.

Caller-focus attribution was clarified as accepted intent, not changed into emitter allocation. Unknown/null caller or initial ancestry remains a conservative reader projection, not a fabricated stored fact.

Lucette's current-snapshot thirteen relevant suites passed 167/167 with `--maxWorkers=2`; Node/web typechecks, loader, Biome checks on six files, whitespace and context lint on 160 files passed with stable thirteen-path hashes. Waylon's old-method/transfer and persistent-DB cleanup retry trials, Tendai's four real-bridge tests, Morag's 151/151 author run and Agnieszka's world build test/package inclusion check remain separately attributed. New pre-launch fixtures, scripted bridge tests and existing process suites are distinct proof.

The operator approved all 31 diff hunks. All thirteen committed blobs at ebb54f5b matched the chair-tested hashes. This is scoped proof tied to committed bytes, not an isolated whole-commit or installed-package test. No full suite, native CLI end-to-end, paid model, live rollout/restart or pi_exec composition proof is claimed. Migrations 28/29 and root-session refresh still require separately authorized rollout; legacy unknown callers/ancestry/deleted spans and observation-time/timestamp conventions remain explicit.
