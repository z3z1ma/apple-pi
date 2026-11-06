---- MODULE OrganizationLifecycle ----
EXTENDS Naturals, FiniteSets

CONSTANT UnsafeCommit
People == 1..5
Lasting == 1..4
Root == 1
Foreign == 4
Peer == 5
None == 0

VARIABLES live, departed, files, writers, parents, busy, work,
          incorporated, rootOpen, closing, epoch, up, selected,
          selectedEpoch, programOpen, unsafeDeparture, unsafeRemoval

vars == <<live, departed, files, writers, parents, busy, work,
          incorporated, rootOpen, closing, epoch, up, selected,
          selectedEpoch, programOpen, unsafeDeparture, unsafeRemoval>>

InOrganization(p) == p \in {1, 2, 5} \/ (p = 3 /\ parents[3] = 2)
Reports(p) == {q \in live : q # p /\ parents[q] = p}
Idle(p) == p \notin busy /\ p \notin work
Ready(p) == p \in live \ departed /\ Idle(p) /\ Reports(p) = {}
            /\ (p # 2 \/ ~programOpen)
Authorized(p) == closing /\ ~rootOpen /\ Root \notin incorporated
                 /\ InOrganization(p) /\ selectedEpoch = epoch

Init ==
    /\ live = People
    /\ departed = {}
    /\ files = People
    /\ writers = People
    /\ parents = [p \in People |-> CASE p = 2 -> 1 [] p = 3 -> 2 [] p = 5 -> 2 [] OTHER -> 0]
    /\ busy = {2, 3, 5}
    /\ work = {2, 3, 5}
    /\ incorporated = {Foreign}
    /\ rootOpen = TRUE
    /\ closing = FALSE
    /\ epoch = 0
    /\ up = TRUE
    /\ selected = None
    /\ selectedEpoch = 0
    /\ programOpen = TRUE
    /\ unsafeDeparture = FALSE
    /\ unsafeRemoval = FALSE

CloseRoot ==
    /\ up /\ rootOpen /\ Root \in live \ departed /\ epoch < 3
    /\ rootOpen' = FALSE
    /\ closing' = (Root \notin incorporated)
    /\ epoch' = epoch + 1
    /\ busy' = busy \ {Root}
    /\ UNCHANGED <<live, departed, files, writers, parents, work, incorporated,
                    up, selected, selectedEpoch, programOpen, unsafeDeparture, unsafeRemoval>>

LoseRoot ==
    /\ rootOpen /\ Root \in writers
    /\ rootOpen' = FALSE
    /\ writers' = writers \ {Root}
    /\ busy' = busy \ {Root}
    /\ UNCHANGED <<live, departed, files, parents, work, incorporated, closing, epoch,
                    up, selected, selectedEpoch, programOpen, unsafeDeparture, unsafeRemoval>>

ReopenRoot ==
    /\ up /\ ~rootOpen /\ Root \in live \ departed /\ epoch < 3
    /\ rootOpen' = TRUE
    /\ closing' = FALSE
    /\ epoch' = epoch + 1
    /\ writers' = writers \cup {Root}
    /\ UNCHANGED <<live, departed, files, parents, busy, work, incorporated,
                    up, selected, selectedEpoch, programOpen, unsafeDeparture, unsafeRemoval>>

Incorporate ==
    /\ up /\ Root \in live \ departed /\ Root \notin incorporated
    /\ incorporated' = incorporated \cup {Root}
    /\ closing' = FALSE
    /\ UNCHANGED <<live, departed, files, writers, parents, busy, work, rootOpen, epoch,
                    up, selected, selectedEpoch, programOpen, unsafeDeparture, unsafeRemoval>>

SplitLeaf ==
    /\ up /\ 3 \in live \ departed /\ 3 \notin work /\ parents[3] # 0
    /\ parents' = [parents EXCEPT ![3] = 0]
    /\ incorporated' = IF parents[3] = Foreign \/ Root \in incorporated
                        THEN incorporated \cup {3} ELSE incorporated \ {3}
    /\ UNCHANGED <<live, departed, files, writers, busy, work, rootOpen, closing, epoch,
                    up, selected, selectedEpoch, programOpen, unsafeDeparture, unsafeRemoval>>

MoveLeaf ==
    /\ up /\ 3 \in live \ departed /\ 3 \notin work
    /\ parents[3] = 2 \/ 2 \in live \ departed
    /\ parents' = [parents EXCEPT ![3] = IF @ = 2 THEN Foreign ELSE 2]
    /\ UNCHANGED <<live, departed, files, writers, busy, work, incorporated, rootOpen,
                    closing, epoch, up, selected, selectedEpoch, programOpen, unsafeDeparture, unsafeRemoval>>

Settle(p) ==
    /\ p \in live \ departed /\ p \in busy
    /\ busy' = busy \ {p}
    /\ UNCHANGED <<live, departed, files, writers, parents, work, incorporated, rootOpen, closing,
                    epoch, up, selected, selectedEpoch, programOpen, unsafeDeparture, unsafeRemoval>>

BeginTurn(p) ==
    /\ up /\ p \in live \ departed /\ p \notin busy /\ p # Foreign
    /\ busy' = busy \cup {p}
    /\ UNCHANGED <<live, departed, files, writers, parents, work, incorporated, rootOpen, closing,
                    epoch, up, selected, selectedEpoch, programOpen, unsafeDeparture, unsafeRemoval>>

FinishWork(p) ==
    /\ up /\ p \in work
    /\ work' = work \ {p}
    /\ UNCHANGED <<live, departed, files, writers, parents, busy, incorporated, rootOpen, closing,
                    epoch, up, selected, selectedEpoch, programOpen, unsafeDeparture, unsafeRemoval>>

AcquireWork(p) ==
    /\ up /\ p \in live \ departed /\ p \notin work /\ p # Foreign
    /\ work' = work \cup {p}
    /\ UNCHANGED <<live, departed, files, writers, parents, busy, incorporated, rootOpen, closing,
                    epoch, up, selected, selectedEpoch, programOpen, unsafeDeparture, unsafeRemoval>>

CloseProgram ==
    /\ up /\ programOpen /\ Idle(Peer)
    /\ programOpen' = FALSE
    /\ UNCHANGED <<live, departed, files, writers, parents, busy, work, incorporated, rootOpen,
                    closing, epoch, up, selected, selectedEpoch, unsafeDeparture, unsafeRemoval>>

DisposePeer ==
    /\ up /\ ~programOpen /\ Peer \in live \ departed /\ Idle(Peer)
    /\ departed' = departed \cup {Peer}
    /\ UNCHANGED <<live, files, writers, parents, busy, work, incorporated, rootOpen,
                    closing, epoch, up, selected, selectedEpoch, programOpen, unsafeDeparture, unsafeRemoval>>

Select(p) ==
    /\ up /\ selected = None /\ p \in Lasting /\ p # Foreign
    /\ closing /\ ~rootOpen /\ Root \notin incorporated /\ InOrganization(p) /\ Ready(p)
    /\ selected' = p
    /\ selectedEpoch' = epoch
    /\ UNCHANGED <<live, departed, files, writers, parents, busy, work, incorporated, rootOpen,
                    closing, epoch, up, programOpen, unsafeDeparture, unsafeRemoval>>

Commit ==
    /\ up /\ selected # None /\ Ready(selected)
    /\ UnsafeCommit \/ Authorized(selected)
    /\ departed' = departed \cup {selected}
    /\ unsafeDeparture' = (unsafeDeparture \/ ~Authorized(selected) \/ ~Ready(selected))
    /\ selected' = None
    /\ UNCHANGED <<live, files, writers, parents, busy, work, incorporated, rootOpen,
                    closing, epoch, up, selectedEpoch, programOpen, unsafeRemoval>>

RejectSelection ==
    /\ up /\ selected # None /\ (~Authorized(selected) \/ ~Ready(selected))
    /\ selected' = None
    /\ UNCHANGED <<live, departed, files, writers, parents, busy, work, incorporated, rootOpen,
                    closing, epoch, up, selectedEpoch, programOpen, unsafeDeparture, unsafeRemoval>>

Exit(p) ==
    /\ p \in writers /\ p # Foreign /\ (p \in departed \/ (p = Root /\ ~rootOpen))
    /\ writers' = writers \ {p}
    /\ UNCHANGED <<live, departed, files, parents, busy, work, incorporated, rootOpen,
                    closing, epoch, up, selected, selectedEpoch, programOpen, unsafeDeparture, unsafeRemoval>>

Unlink(p) ==
    /\ up /\ p \in departed \cap files /\ p \notin writers
    /\ files' = files \ {p}
    /\ unsafeRemoval' = (unsafeRemoval \/ p \notin departed \/ p \in writers)
    /\ UNCHANGED <<live, departed, writers, parents, busy, work, incorporated, rootOpen,
                    closing, epoch, up, selected, selectedEpoch, programOpen, unsafeDeparture>>

RemoveRecords(p) ==
    /\ up /\ p \in live \cap departed /\ p \notin files \cup writers
    /\ live' = live \ {p}
    /\ UNCHANGED <<departed, files, writers, parents, busy, work, incorporated, rootOpen,
                    closing, epoch, up, selected, selectedEpoch, programOpen, unsafeDeparture, unsafeRemoval>>

Crash ==
    /\ up
    /\ up' = FALSE
    /\ selected' = None
    /\ UNCHANGED <<live, departed, files, writers, parents, busy, work, incorporated, rootOpen,
                    closing, epoch, selectedEpoch, programOpen, unsafeDeparture, unsafeRemoval>>

Restart ==
    /\ ~up
    /\ up' = TRUE
    /\ UNCHANGED <<live, departed, files, writers, parents, busy, work, incorporated, rootOpen,
                    closing, epoch, selected, selectedEpoch, programOpen, unsafeDeparture, unsafeRemoval>>

Next == CloseRoot \/ LoseRoot \/ ReopenRoot \/ Incorporate \/ MoveLeaf \/ SplitLeaf \/ CloseProgram
        \/ DisposePeer \/ Commit \/ RejectSelection \/ Crash \/ Restart
        \/ (\E p \in People : BeginTurn(p) \/ Settle(p) \/ FinishWork(p) \/ AcquireWork(p) \/ Exit(p) \/ Unlink(p) \/ RemoveRecords(p))
        \/ (\E p \in Lasting : Select(p))

TypeOK ==
    /\ live \subseteq People /\ departed \subseteq People /\ files \subseteq People
    /\ writers \subseteq People /\ parents \in [People -> 0..5]
    /\ busy \subseteq People /\ work \subseteq People /\ incorporated \subseteq {Root, 3, Foreign}
    /\ rootOpen \in BOOLEAN /\ closing \in BOOLEAN /\ up \in BOOLEAN /\ programOpen \in BOOLEAN
    /\ epoch \in 0..3 /\ selected \in 0..4 /\ selectedEpoch \in 0..3
    /\ unsafeDeparture \in BOOLEAN /\ unsafeRemoval \in BOOLEAN
NoInvalidDeparture == ~unsafeDeparture
NoUnsafeRemoval == ~unsafeRemoval
ForeignRootKept == Foreign \in live \cap files /\ Foreign \notin departed
RecordsAfterFiles == (People \ live) \cap (files \cup writers) = {}
RootLast == Root \in departed => \A p \in live \ {Root} : ~InOrganization(p)
NoReopenDeparture == rootOpen => Root \notin departed
Spec == Init /\ [][Next]_vars
====
