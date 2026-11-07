---- MODULE NativeQuiescence ----
EXTENDS Naturals, FiniteSets
CONSTANTS Objects, UnsafeLocal, UnsafeTree
VARIABLES work, current, frozen, proof, departed, unsafe
vars == <<work, current, frozen, proof, departed, unsafe>>
Init == /\ work = [o \in 1..Objects |-> "none"] /\ current = 1
        /\ frozen = FALSE /\ proof = FALSE /\ departed = FALSE /\ unsafe = FALSE
Input == /\ ~departed /\ ~frozen /\ work[current] = "none"
         /\ work' = [work EXCEPT ![current] = "preparing"]
         /\ UNCHANGED <<current, frozen, proof, departed, unsafe>>
Tree == /\ ~departed /\ (UnsafeTree \/ ~frozen) /\ work[current] = "none"
        /\ work' = [work EXCEPT ![current] = "tree"]
        /\ UNCHANGED <<current, frozen, proof, departed, unsafe>>
Replace == /\ ~departed /\ current < Objects
           /\ current' = current + 1 /\ proof' = FALSE
           /\ UNCHANGED <<work, frozen, departed, unsafe>>
Start(o) == /\ ~departed /\ work[o] = "preparing"
            /\ work' = [work EXCEPT ![o] = "active"]
            /\ UNCHANGED <<current, frozen, proof, departed, unsafe>>
Settle(o) == /\ ~departed /\ work[o] # "none"
             /\ work' = [work EXCEPT ![o] = "none"]
             /\ UNCHANGED <<current, frozen, proof, departed, unsafe>>
Agree == /\ ~departed /\ ~frozen
         /\ IF UnsafeLocal THEN work[current] = "none" ELSE \A o \in 1..Objects: work[o] = "none"
         /\ frozen' = TRUE /\ proof' = TRUE
         /\ UNCHANGED <<work, current, departed, unsafe>>
Release == /\ ~departed /\ frozen
           /\ proof' = FALSE /\ frozen' = FALSE
           /\ UNCHANGED <<work, current, departed, unsafe>>
Commit == /\ ~departed /\ frozen /\ proof
          /\ departed' = TRUE /\ unsafe' = (\E o \in 1..Objects: work[o] # "none")
          /\ UNCHANGED <<work, current, frozen, proof>>
Next == Input \/ Tree \/ Replace \/ Agree \/ Release \/ Commit
        \/ (\E o \in 1..Objects: Start(o) \/ Settle(o))
TypeOK == /\ work \in [1..Objects -> {"none", "preparing", "tree", "active"}]
          /\ current \in 1..Objects /\ frozen \in BOOLEAN /\ proof \in BOOLEAN
          /\ departed \in BOOLEAN /\ unsafe \in BOOLEAN
NoUnsafeDeparture == ~unsafe
Spec == Init /\ [][Next]_vars
====
