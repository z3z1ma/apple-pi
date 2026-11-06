--------------------------- MODULE ReviewWorkers ---------------------------
EXTENDS Integers, Sequences, TLC
CONSTANT UnsafeCleanup
Attempts == 1..3
Workers == <<"worker1", "worker2">>
Reviewer(a) == IF a <= Len(Workers) THEN Workers[a] ELSE "temp"
VARIABLES stage, assigned, scope, alive, running, cancelled, originals
vars == <<stage, assigned, scope, alive, running, cancelled, originals>>
Init == /\ stage = [a \in Attempts |-> "new"]
        /\ assigned = [a \in Attempts |-> "none"]
        /\ scope = {} /\ alive = {} /\ running = TRUE /\ cancelled = FALSE
        /\ originals = {"worker1", "worker2"}
Staff(a) == /\ running /\ ~cancelled /\ stage[a] = "new"
            /\ stage' = [stage EXCEPT ![a] = "starting"]
            /\ assigned' = [assigned EXCEPT ![a] = Reviewer(a)]
            /\ scope' = scope \cup {a}
            /\ UNCHANGED <<alive, running, cancelled, originals>>
Launch(a) == /\ running /\ ~cancelled /\ stage[a] = "starting"
             /\ stage' = [stage EXCEPT ![a] = "running"]
             /\ alive' = alive \cup {a}
             /\ UNCHANGED <<assigned, scope, running, cancelled, originals>>
Finish(a) == /\ running /\ stage[a] = "running"
             /\ stage' = [stage EXCEPT ![a] = "cleaning"]
             /\ UNCHANGED <<assigned, scope, alive, running, cancelled, originals>>
Cancel == /\ running /\ ~cancelled /\ cancelled' = TRUE
          /\ stage' = [a \in Attempts |-> IF a \in scope THEN "cleaning" ELSE stage[a]]
          /\ UNCHANGED <<assigned, scope, alive, running, originals>>
Stop(a) == /\ running /\ stage[a] = "cleaning" /\ a \in alive
           /\ alive' = alive \ {a}
           /\ UNCHANGED <<stage, assigned, scope, running, cancelled, originals>>
Clean(a) == /\ running /\ stage[a] = "cleaning" /\ a \notin alive
            /\ stage' = [stage EXCEPT ![a] = "done"]
            /\ scope' = scope \ {a}
            /\ originals' = IF UnsafeCleanup THEN originals \ {assigned[a]} ELSE originals
            /\ UNCHANGED <<assigned, alive, running, cancelled>>
Crash == /\ running /\ running' = FALSE
         /\ UNCHANGED <<stage, assigned, scope, alive, cancelled, originals>>
Recover == /\ ~running /\ running' = TRUE
           /\ stage' = [a \in Attempts |-> IF a \in scope THEN "cleaning" ELSE stage[a]]
           /\ UNCHANGED <<assigned, scope, alive, cancelled, originals>>
Next == (\E a \in Attempts: Staff(a) \/ Launch(a) \/ Finish(a) \/ Stop(a) \/ Clean(a))
        \/ Cancel \/ Crash \/ Recover
Spec == Init /\ [][Next]_vars
OriginalsPreserved == originals = {"worker1", "worker2"}
PlanOrder == \A a \in Attempts: assigned[a] \in {"none", Reviewer(a)}
OwnedProcesses == alive \subseteq scope
SettledClean == \A a \in Attempts: stage[a] = "done" => a \notin (alive \cup scope)
=============================================================================
