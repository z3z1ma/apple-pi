-------------------------- MODULE ElanPublication ---------------------------
(* lean.ts: elanHome installs elan into its own staging directory, then
   publish() renames the staging directory onto the cache home. rename()
   replaces a missing or empty home atomically and fails with ENOTEMPTY on a
   home that holds files; then a complete home is used and an incomplete one is
   an error for the operator to remove. Nothing moves or deletes a home. *)
CONSTANT Procs
VARIABLES home, alive, pc, wasComplete
vars == <<home, alive, pc, wasComplete>>

Init ==
    /\ home \in {"none", "incomplete"}
    /\ alive = [p \in Procs |-> TRUE]
    /\ pc = [p \in Procs |-> "stage"]
    /\ wasComplete = FALSE

Goto(p, to) == pc' = [pc EXCEPT ![p] = to]

(* elan-init into the call's own staging directory; it touches no home. *)
Stage(p) ==
    /\ alive[p] /\ pc[p] = "stage"
    /\ Goto(p, "publish")
    /\ UNCHANGED <<home, alive, wasComplete>>

(* rename(staging, home), then launchers(home) on ENOTEMPTY *)
Publish(p) ==
    /\ alive[p] /\ pc[p] = "publish"
    /\ CASE home = "none" -> home' = "complete" /\ Goto(p, "done")
         [] home = "complete" -> UNCHANGED home /\ Goto(p, "done")
         [] home = "incomplete" -> UNCHANGED home /\ Goto(p, "failed")
    /\ wasComplete' = (wasComplete \/ home' = "complete")
    /\ UNCHANGED alive

Crash(p) ==
    /\ alive[p] /\ pc[p] \in {"stage", "publish"}
    /\ alive' = [alive EXCEPT ![p] = FALSE]
    /\ UNCHANGED <<home, pc, wasComplete>>

Next == \E p \in Procs : Stage(p) \/ Publish(p) \/ Crash(p)

Spec == Init /\ [][Next]_vars

TypeOK ==
    /\ home \in {"none", "incomplete", "complete"}
    /\ pc \in [Procs -> {"stage", "publish", "done", "failed"}]

(* A complete home is never replaced, moved or lost. *)
CompleteStays == wasComplete => home = "complete"

(* A call that returns a home returns a complete one. *)
DoneMeansComplete == \A p \in Procs : pc[p] = "done" => home = "complete"

(* A call fails only on an incomplete home it did not create. *)
FailureMeansIncomplete == \A p \in Procs : pc[p] = "failed" => home = "incomplete"
=============================================================================
