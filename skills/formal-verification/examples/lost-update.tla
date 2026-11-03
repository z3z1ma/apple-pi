---- MODULE LostUpdate ----
\* Two workers each add 1 to a shared counter by reading it, then writing
\* the value they read plus one. Reading and writing are separate steps, as
\* in code that loads a row, computes, and saves it without a transaction.
EXTENDS Naturals

Workers == {"a", "b"}

VARIABLES counter, seen, pc

Init ==
    /\ counter = 0
    /\ seen = [w \in Workers |-> 0]
    /\ pc = [w \in Workers |-> "read"]

Read(w) ==
    /\ pc[w] = "read"
    /\ seen' = [seen EXCEPT ![w] = counter]
    /\ pc' = [pc EXCEPT ![w] = "write"]
    /\ UNCHANGED counter

Write(w) ==
    /\ pc[w] = "write"
    /\ counter' = seen[w] + 1
    /\ pc' = [pc EXCEPT ![w] = "done"]
    /\ UNCHANGED seen

Next == \E w \in Workers : Read(w) \/ Write(w)

\* Once both workers are done, both increments are counted.
BothCounted == (\A w \in Workers : pc[w] = "done") => counter = 2
====
