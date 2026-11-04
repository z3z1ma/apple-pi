------------------------ MODULE ElanPublicationLock -------------------------
(* lean.ts: elanHome stages a complete install, then publish() takes the
   lock file <home>.lock (created exclusively, holding the owner's pid),
   keeps a complete home, or moves an incomplete one aside and renames the
   staged install into place, and finally removes the lock file.
   A waiter that reads a lock owned by a dead pid removes the lock file. *)
EXTENDS Naturals, FiniteSets

CONSTANT Procs
VARIABLES home, lock, alive, pc, seen, replaced
vars == <<home, lock, alive, pc, seen, replaced>>

Critical == {"check", "aside", "rename"}

Init ==
    /\ home \in {"none", "incomplete"}
    /\ lock = "free"
    /\ alive = [p \in Procs |-> TRUE]
    /\ pc = [p \in Procs |-> "acquire"]
    /\ seen = [p \in Procs |-> "free"]
    /\ replaced = FALSE

Goto(p, to) == pc' = [pc EXCEPT ![p] = to]

(* writeFile(lock, pid, { flag: "wx" }) *)
Acquire(p) ==
    /\ alive[p] /\ pc[p] = "acquire"
    /\ IF lock = "free"
          THEN lock' = p /\ Goto(p, "check")
          ELSE UNCHANGED lock /\ Goto(p, "readOwner")
    /\ UNCHANGED <<home, alive, seen, replaced>>

(* EEXIST: read the owner's pid. *)
ReadOwner(p) ==
    /\ alive[p] /\ pc[p] = "readOwner"
    /\ seen' = [seen EXCEPT ![p] = lock]
    /\ Goto(p, "decide")
    /\ UNCHANGED <<home, lock, alive, replaced>>

(* if (owner && !running(owner)) rm(lock) else sleep and retry *)
Decide(p) ==
    /\ alive[p] /\ pc[p] = "decide"
    /\ IF seen[p] # "free" /\ ~alive[seen[p]]
          THEN Goto(p, "removeStale")
          ELSE Goto(p, "acquire")
    /\ UNCHANGED <<home, lock, alive, seen, replaced>>

(* rm(lock): removes whatever lock file exists now. *)
RemoveStale(p) ==
    /\ alive[p] /\ pc[p] = "removeStale"
    /\ lock' = "free"
    /\ Goto(p, "acquire")
    /\ UNCHANGED <<home, alive, seen, replaced>>

(* if (await launchers(home)) return *)
Check(p) ==
    /\ alive[p] /\ pc[p] = "check"
    /\ Goto(p, IF home = "complete" THEN "release" ELSE "aside")
    /\ UNCHANGED <<home, lock, alive, seen, replaced>>

(* rename(home, aside), ENOENT ignored *)
Aside(p) ==
    /\ alive[p] /\ pc[p] = "aside"
    /\ replaced' = (replaced \/ home = "complete")
    /\ home' = "none"
    /\ Goto(p, "rename")
    /\ UNCHANGED <<lock, alive, seen>>

(* rename(staging, home); a non-empty home makes it throw *)
Rename(p) ==
    /\ alive[p] /\ pc[p] = "rename"
    /\ home' = IF home = "none" THEN "complete" ELSE home
    /\ Goto(p, "release")
    /\ UNCHANGED <<lock, alive, seen, replaced>>

(* finally rm(lock) *)
Release(p) ==
    /\ alive[p] /\ pc[p] = "release"
    /\ lock' = "free"
    /\ Goto(p, "done")
    /\ UNCHANGED <<home, alive, seen, replaced>>

Crash(p) ==
    /\ alive[p] /\ pc[p] # "done"
    /\ alive' = [alive EXCEPT ![p] = FALSE]
    /\ UNCHANGED <<home, lock, pc, seen, replaced>>

Next == \E p \in Procs :
    Acquire(p) \/ ReadOwner(p) \/ Decide(p) \/ RemoveStale(p) \/ Check(p)
    \/ Aside(p) \/ Rename(p) \/ Release(p) \/ Crash(p)

Spec == Init /\ [][Next]_vars

TypeOK ==
    /\ home \in {"none", "incomplete", "complete"}
    /\ lock \in Procs \cup {"free"}
    /\ replaced \in BOOLEAN

(* No call ever moves a complete home aside. *)
NoCompleteReplaced == ~replaced

(* At most one live process is between acquiring and releasing the lock. *)
MutualExclusion ==
    Cardinality({p \in Procs : alive[p] /\ pc[p] \in Critical}) <= 1
=============================================================================
