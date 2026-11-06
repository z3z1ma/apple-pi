--------------------------- MODULE BatchGuard ---------------------------
EXTENDS Naturals, FiniteSets
CONSTANT Guard
VARIABLES pending, complete, observed, failed
vars == <<pending, complete, observed, failed>>
Calls == {"editA", "readA", "editB", "readB", "readC"}
Writers == {"editA", "editB"}
Readers == {"readA", "readB", "readC"}
Depends == [c \in Readers |-> CASE c = "readA" -> {"editA"}
                              [] c = "readB" -> {"editB"}
                              [] OTHER -> {}]
Init == /\ pending = Calls /\ complete = {} /\ observed = {} /\ failed = {}
Step(c) == /\ c \in pending
           /\ pending' = pending \ {c}
           /\ IF c \in Readers /\ Guard /\ Depends[c] # {}
              THEN /\ failed' = failed \cup {c}
                   /\ UNCHANGED <<complete, observed>>
              ELSE /\ complete' = complete \cup {c}
                   /\ failed' = failed
                   /\ observed' = IF c \in Readers /\ ~(Depends[c] \subseteq complete)
                                  THEN observed \cup {c} ELSE observed
FailWrite(c) == /\ c \in pending \cap Writers
                /\ pending' = pending \ {c}
                /\ failed' = failed \cup {c}
                /\ UNCHANGED <<complete, observed>>
Next == (\E c \in Calls: Step(c)) \/ (\E c \in Writers: FailWrite(c))
Spec == Init /\ [][Next]_vars
NoStaleCheck == observed = {}
IndependentPermitted == "readC" \notin failed
TypeOK == /\ pending \subseteq Calls /\ complete \subseteq Calls
          /\ failed \subseteq Calls /\ observed \subseteq Readers
=============================================================================
