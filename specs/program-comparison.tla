------------------------- MODULE ProgramComparison -------------------------
(* compare.ts runSample and comparePrograms, as built: each sample makes a
   temporary directory, adds a git worktree in it, opens a peer program,
   starts a peer and runs its turn, closes the program, runs the task's check
   and removes the worktree (falling back to deleting the directory and
   pruning). A turn's own failure is the sample's result; a failure of the
   worktree, the program or its close, or an abort, ends the comparison.
   Samples run one after another.

   Properties, from ticket 04: every worktree and temporary directory is gone
   when a sample ends, except one closeFailed for inspection because its peer's
   cleanup failed and the peer may still use it; a worktree is never removed
   while its peer may be alive; no later sample starts while a peer of an
   earlier one may still be alive.

   CleanupOnAddFailure = FALSE models the first draft, which added the worktree
   outside the try block, so a failed add left the directory; StopOnCloseFailure
   = FALSE models the draft that recorded a failed close as a sample error,
   removed the worktree and went on. Each must violate a property. *)
EXTENDS Naturals

CONSTANTS Samples, CleanupOnAddFailure, StopOnCloseFailure
VARIABLES sample, phase, dir, peer, failed, ended, closeFailed
vars == <<sample, phase, dir, peer, failed, ended, closeFailed>>

Init == sample = 1 /\ phase = "make" /\ dir = "none" /\ peer = "none" /\ failed = FALSE /\ ended = FALSE /\ closeFailed = FALSE

Go(p) == phase' = p
Keep == UNCHANGED <<sample, peer, failed, ended>>

Make == phase = "make" /\ ~ended /\ dir' = "empty" /\ Go("add") /\ Keep

Add == phase = "add" /\ dir' = "worktree" /\ Go("open") /\ Keep
AddFails ==
    /\ phase = "add"
    /\ IF CleanupOnAddFailure THEN Go("remove") ELSE Go("end")
    /\ failed' = TRUE /\ UNCHANGED <<sample, dir, peer, ended>>

Open == phase = "open" /\ Go("turn") /\ UNCHANGED <<sample, dir, peer, failed, ended>>
OpenFails == phase = "open" /\ Go("remove") /\ failed' = TRUE /\ UNCHANGED <<sample, dir, peer, ended>>

Turn == phase = "turn" /\ peer' = "alive" /\ Go("close") /\ UNCHANGED <<sample, dir, failed, ended>>
TurnFailsBeforeStart == phase = "turn" /\ Go("close") /\ UNCHANGED <<sample, dir, peer, failed, ended>>
Abort == phase \in {"turn", "check"} /\ Go(IF phase = "turn" THEN "close" ELSE "remove") /\ failed' = TRUE
         /\ UNCHANGED <<sample, dir, peer, ended>>

Close == phase = "close" /\ peer' = "none" /\ Go(IF failed THEN "remove" ELSE "check")
         /\ UNCHANGED <<sample, dir, failed, ended>>
CloseFails ==
    /\ phase = "close"
    /\ IF StopOnCloseFailure
          THEN failed' = TRUE /\ Go("end")
          ELSE UNCHANGED failed /\ Go("remove")
    /\ UNCHANGED <<sample, dir, peer, ended>>

Check == phase = "check" /\ Go("remove") /\ UNCHANGED <<sample, dir, peer, failed, ended>>

Remove == phase = "remove" /\ dir' = "none" /\ Go("end") /\ Keep
RemoveFails == phase = "remove" /\ dir' = "none" /\ Go("end") /\ failed' = TRUE /\ UNCHANGED <<sample, peer, ended>>

End ==
    /\ phase = "end"
    /\ IF failed \/ sample = Samples
          THEN ended' = TRUE /\ UNCHANGED <<sample, phase>>
          ELSE sample' = sample + 1 /\ phase' = "make" /\ UNCHANGED ended
    /\ UNCHANGED <<dir, peer, failed>>

Next == (CloseFails /\ closeFailed' = TRUE)
        \/ ((Make \/ Add \/ AddFails \/ Open \/ OpenFails \/ Turn \/ TurnFailsBeforeStart \/ Abort
            \/ Close \/ Check \/ Remove \/ RemoveFails \/ End) /\ UNCHANGED closeFailed)

Spec == Init /\ [][Next]_vars /\ WF_vars(Next)

TypeOK ==
    /\ sample \in 1..Samples /\ dir \in {"none", "empty", "worktree"} /\ peer \in {"none", "alive"}
    /\ phase \in {"make", "add", "open", "turn", "close", "check", "remove", "end"}
    /\ failed \in BOOLEAN /\ ended \in BOOLEAN /\ closeFailed \in BOOLEAN

NothingLeftWhenSampleEnds == phase = "end" => dir = "none" \/ closeFailed

RemoveOnlyAfterPeerCleanup == phase = "remove" => ~closeFailed

NoNewSampleBesideALivePeer == phase = "make" => peer = "none"

ComparisonEnds == <>ended
=============================================================================
