-------------------------- MODULE SemaphoreCancel --------------------------
EXTENDS Naturals

VARIABLES head, waiter, cancelled, audited
vars == <<head, waiter, cancelled, audited>>

(* Semaphore starts with value 1. The sole acquire asks for weight 2 and
   priority 0. The sole unlock observer asks for weight 1 and priority 0.
   There are no holders, releases, timeouts or value changes in this cut. *)
Init ==
    /\ head = "none" /\ waiter = "none"
    /\ cancelled = FALSE /\ audited = FALSE

(* Semaphore.acquire enqueues the heavy task because weight exceeds value. *)
AcquireHeavy ==
    /\ head = "none" /\ ~cancelled
    /\ head' = "queued"
    /\ UNCHANGED <<waiter, cancelled, audited>>

(* waitForUnlock and _couldLockImmediately: an equal-priority queue head
   blocks this observer even though its own weight fits the free value. *)
WaitLight ==
    /\ waiter = "none"
    /\ waiter' = IF head = "queued" THEN "pending" ELSE "notified"
    /\ UNCHANGED <<head, cancelled, audited>>

(* Semaphore.cancel rejects queued acquisitions and clears _queue. It
   leaves _weightedWaiters unchanged and does not call _drainUnlockWaiters. *)
Cancel ==
    /\ ~cancelled /\ cancelled' = TRUE
    /\ head' = IF head = "queued" THEN "cancelled" ELSE head
    /\ UNCHANGED <<waiter, audited>>

(* An ordinary fresh waitForUnlock(1, 0) now resolves immediately. Observe
   after that promise barrier and the cancelled acquisition's rejection.
   The existing observer should have been notified when it became eligible. *)
Audit ==
    /\ cancelled /\ head # "queued" /\ waiter # "none" /\ ~audited
    /\ audited' = TRUE
    /\ UNCHANGED <<head, waiter, cancelled>>

Next == AcquireHeavy \/ WaitLight \/ Cancel \/ Audit
Spec == Init /\ [][Next]_vars
TypeOK ==
    /\ head \in {"none", "queued", "cancelled"}
    /\ waiter \in {"none", "pending", "notified"}
    /\ cancelled \in BOOLEAN /\ audited \in BOOLEAN
EligibleObserverNotStranded == audited => waiter # "pending"
=============================================================================
