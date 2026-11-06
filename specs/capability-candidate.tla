------------------------- MODULE CapabilityCandidate -------------------------
(* Design model (written before the steward ran) of one candidate's life under
   the capability-steward role (roles/capability-steward.md): draft, prove
   (replay_rule, a guard's batch scan, or compare_program), challenge
   (review_code), bring as a ledger task with a sign-off page, then the
   operator approves or declines. After approval the steward merges; after a
   decline it closes. A challenge can break the candidate; the steward then
   revises it (a new version) or drops it. The operator's sign-off notes can
   also ask for a revision of a brought candidate.

   Properties, from the approved proposal: nothing reaches the main line
   without the operator approving that exact version; what reaches it carries
   evidence and a passed challenge for that exact version; a declined or
   dropped candidate never reaches it; and every candidate is eventually
   closed when revisions are bounded and the operator eventually decides.

   KeepEvidenceOnRevise = TRUE models a steward that keeps the old version's
   evidence after revising; it must violate EvidenceForMerged. *)
EXTENDS Naturals

CONSTANTS MaxVersion, KeepEvidenceOnRevise
VARIABLES version, proven, challenged, broken, brought, decision, approved, merged, closed
vars == <<version, proven, challenged, broken, brought, decision, approved, merged, closed>>

None == 0

Init ==
    /\ version = 1 /\ proven = None /\ challenged = None /\ broken = FALSE
    /\ brought = None /\ decision = "none" /\ approved = None /\ merged = None /\ closed = FALSE

Open == ~closed /\ decision # "approved"

Prove ==
    /\ Open /\ proven # version
    /\ proven' = version
    /\ UNCHANGED <<version, challenged, broken, brought, decision, approved, merged, closed>>

Challenge ==
    /\ Open /\ proven = version /\ challenged # version
    /\ challenged' = version
    /\ broken' \in BOOLEAN
    /\ UNCHANGED <<version, proven, brought, decision, approved, merged, closed>>

Revise ==
    /\ Open /\ version < MaxVersion
    /\ (challenged = version /\ broken) \/ decision = "changes"
    /\ version' = version + 1
    /\ broken' = FALSE /\ brought' = None /\ decision' = "none"
    /\ proven' = IF KeepEvidenceOnRevise THEN proven ELSE None
    /\ challenged' = IF KeepEvidenceOnRevise THEN challenged ELSE None
    /\ UNCHANGED <<approved, merged, closed>>

Drop ==
    /\ Open /\ ((challenged = version /\ broken) \/ decision = "changes")
    /\ closed' = TRUE
    /\ UNCHANGED <<version, proven, challenged, broken, brought, decision, approved, merged>>

Bring ==
    /\ Open /\ brought = None /\ decision = "none"
    /\ proven = version \/ KeepEvidenceOnRevise
    /\ challenged = version \/ KeepEvidenceOnRevise
    /\ proven # None /\ challenged # None /\ ~broken
    /\ brought' = version
    /\ UNCHANGED <<version, proven, challenged, broken, decision, approved, merged, closed>>

Decide ==
    /\ ~closed /\ brought = version /\ decision = "none"
    /\ decision' \in {"approved", "declined", "changes"}
    /\ approved' = IF decision' = "approved" THEN version ELSE approved
    /\ closed' = (decision' = "declined")
    /\ UNCHANGED <<version, proven, challenged, broken, brought, merged>>

Merge ==
    /\ ~closed /\ decision = "approved"
    /\ merged' = approved /\ closed' = TRUE
    /\ UNCHANGED <<version, proven, challenged, broken, brought, decision, approved>>

Next == Prove \/ Challenge \/ Revise \/ Drop \/ Bring \/ Decide \/ Merge

Spec == Init /\ [][Next]_vars
        /\ WF_vars(Prove) /\ WF_vars(Challenge) /\ WF_vars(Bring) /\ WF_vars(Decide) /\ WF_vars(Merge)
        /\ WF_vars(Revise \/ Drop)

TypeOK ==
    /\ version \in 1..MaxVersion /\ proven \in 0..MaxVersion /\ challenged \in 0..MaxVersion
    /\ broken \in BOOLEAN /\ brought \in 0..MaxVersion /\ approved \in 0..MaxVersion /\ merged \in 0..MaxVersion
    /\ decision \in {"none", "approved", "declined", "changes"} /\ closed \in BOOLEAN

ApprovedOnly == merged # None => merged = approved /\ approved = brought /\ decision = "approved"

EvidenceForMerged == merged # None => proven = merged /\ challenged = merged /\ ~broken

DeclinedNeverMerged == decision = "declined" => merged = None

Closes == <>closed
=============================================================================
