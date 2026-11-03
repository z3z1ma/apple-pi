--------------------------- MODULE TimeoutRelease --------------------------
EXTENDS Naturals

VARIABLES otherHolder, ticket, alarm, outer, handled, callback, free
vars == <<otherHolder, ticket, alarm, outer, handled, callback, free>>

(* withTimeout.runExclusive on a unit semaphore held by one other caller.
   The inner acquire remains queued even if the outer timeout rejects. *)
Init ==
    /\ otherHolder = TRUE /\ ticket = "queued" /\ alarm = "armed"
    /\ outer = "pending" /\ handled = FALSE /\ callback = "none" /\ free = 0

(* Semaphore's holder releases; dispatch reserves the permit and resolves
   the inner acquire. Its await continuation is a separate microtask. *)
Grant ==
    /\ otherHolder /\ otherHolder' = FALSE /\ ticket' = "granted"
    /\ UNCHANGED <<alarm, outer, handled, callback, free>>

(* withTimeout.acquire's timer rejects the outer promise. *)
Timeout ==
    /\ alarm = "armed" /\ alarm' = "fired" /\ outer' = "rejected"
    /\ UNCHANGED <<otherHolder, ticket, handled, callback, free>>

(* The await continuation either returns the ticket and clears the alarm,
   or compensates for an earlier timeout by invoking the real releaser. *)
HandleGrant ==
    /\ ticket = "granted" /\ ~handled /\ handled' = TRUE
    /\ IF alarm = "fired"
       THEN /\ ticket' = "released" /\ free' = 1 /\ UNCHANGED <<outer, alarm>>
       ELSE /\ outer' = "resolved" /\ alarm' = "cleared" /\ UNCHANGED <<ticket, free>>
    /\ UNCHANGED <<otherHolder, callback>>

StartCallback ==
    /\ outer = "resolved" /\ callback = "none" /\ callback' = "running"
    /\ UNCHANGED <<otherHolder, ticket, alarm, outer, handled, free>>

(* runExclusive's finally invokes the releaser even when its worker throws. *)
FinishCallback ==
    /\ callback = "running" /\ callback' = "done" /\ ticket' = "released" /\ free' = 1
    /\ UNCHANGED <<otherHolder, alarm, outer, handled>>

Next == Grant \/ Timeout \/ HandleGrant \/ StartCallback \/ FinishCallback
Spec == Init /\ [][Next]_vars /\ WF_vars(HandleGrant)
TypeOK ==
    /\ otherHolder \in BOOLEAN /\ handled \in BOOLEAN /\ free \in 0..1
    /\ ticket \in {"queued", "granted", "released"}
    /\ alarm \in {"armed", "fired", "cleared"}
    /\ outer \in {"pending", "resolved", "rejected"}
    /\ callback \in {"none", "running", "done"}
NoTimedOutCallback == (alarm = "fired") => callback = "none"
PermitConservation == free + (IF otherHolder THEN 1 ELSE 0) + (IF ticket = "granted" THEN 1 ELSE 0) = 1
LateGrantReturned == (alarm = "fired" /\ ticket = "granted") ~> (ticket = "released")
=============================================================================
