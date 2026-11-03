-------------------------- MODULE ReviewLifecycle --------------------------
EXTENDS Naturals, FiniteSets

CONSTANT Cancels
VARIABLES state, generation, pending, extended, staleCancellation
vars == <<state, generation, pending, extended, staleCancellation>>

(* ReviewJobs.execute(cancel): each request reads the current job, switches
   it to cancelling, awaits active work and waitCleanup, then commits. Two
   requests may wait on the same attempt/program scopes independently. *)
Init ==
    /\ state = "incomplete"
    /\ generation = 1
    /\ pending = [c \in Cancels |-> 0]
    /\ extended = FALSE
    /\ staleCancellation = FALSE

BeginCancel(c) ==
    /\ state \notin {"completed", "cancelled", "no-changes"}
    /\ pending[c] = 0
    /\ pending' = [pending EXCEPT ![c] = generation]
    /\ state' = "cancelling"
    /\ UNCHANGED <<generation, extended, staleCancellation>>

(* Cancellation completion binds the generation observed by its request.
   A completion superseded by an authorized extension changes no job state.
   No resources remain when this action resumes from waitCleanup. *)
FinishCancel(c) ==
    /\ pending[c] # 0
    /\ IF pending[c] = generation THEN state' = "cancelled" ELSE UNCHANGED state
    /\ staleCancellation' = (staleCancellation \/ (pending[c] # generation /\ state' # state))
    /\ pending' = [pending EXCEPT ![c] = 0]
    /\ UNCHANGED <<generation, extended>>

(* A cancelled review is settled. A new, authorized revision/digest-bound
   question can queue the same retained artifact in a new generation. The
   worker may be busy with another review, leaving this job queued. *)
Extend ==
    /\ state = "cancelled" /\ ~extended
    /\ extended' = TRUE /\ generation' = generation + 1
    /\ state' = "queued"
    /\ UNCHANGED <<pending, staleCancellation>>

Next == (\E c \in Cancels : BeginCancel(c) \/ FinishCancel(c)) \/ Extend
Spec == Init /\ [][Next]_vars

TypeOK ==
    /\ state \in {"incomplete", "cancelling", "cancelled", "queued"}
    /\ generation \in {1, 2}
    /\ pending \in [Cancels -> 0..2]
    /\ extended \in BOOLEAN /\ staleCancellation \in BOOLEAN

NoStaleCancellation == ~staleCancellation
=============================================================================
