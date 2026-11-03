------------------------ MODULE DepartureLifecycle -------------------------
EXTENDS Naturals, FiniteSets

CONSTANT Writers
VARIABLES running, phase, requiredHandoff, replyGeneration, generation,
          durableHandoff, obligations, arrived, departed, admitted, removed,
          known, alive, unknown, files, headers, closed, epoch, proof, cleanup,
          unsafeCommit, unsafeDeletion
vars == <<running, phase, requiredHandoff, replyGeneration, generation,
          durableHandoff, obligations, arrived, departed, admitted, removed,
          known, alive, unknown, files, headers, closed, epoch, proof, cleanup,
          unsafeCommit, unsafeDeletion>>

Init ==
    /\ running = TRUE /\ phase = "idle" /\ requiredHandoff \in BOOLEAN
    /\ replyGeneration = 0 /\ generation = 1 /\ durableHandoff = FALSE
    /\ obligations = FALSE /\ arrived = FALSE
    /\ departed = FALSE /\ admitted = TRUE /\ removed = FALSE
    /\ known = {"original"} /\ alive = {"original"}
    /\ unknown \in SUBSET {"original"}
    /\ files = {"original"} /\ headers \in SUBSET Writers
    /\ closed = FALSE /\ epoch = 1 /\ proof = 0 /\ cleanup = "none"
    /\ unsafeCommit = FALSE /\ unsafeDeletion = FALSE

(* Runtime.departureCandidate runs at admission and again in the commit
   transaction. Responsibilities can arrive while the final turn waits. *)
Accept ==
    /\ running /\ phase = "idle" /\ ~obligations /\ admitted
    /\ phase' = "accepted"
    /\ UNCHANGED <<running, requiredHandoff, replyGeneration, generation,
        durableHandoff, obligations, arrived, departed, admitted, removed,
        known, alive, unknown, files, headers, closed, epoch, proof, cleanup,
        unsafeCommit, unsafeDeletion>>

ArriveWork ==
    /\ running /\ ~departed /\ ~arrived
    /\ obligations' = TRUE /\ arrived' = TRUE
    /\ UNCHANGED <<running, phase, requiredHandoff, replyGeneration, generation,
        durableHandoff, departed, admitted, removed, known, alive, unknown,
        files, headers, closed, epoch, proof, cleanup, unsafeCommit, unsafeDeletion>>

FinishWork ==
    /\ running /\ obligations /\ obligations' = FALSE
    /\ UNCHANGED <<running, phase, requiredHandoff, replyGeneration, generation,
        durableHandoff, arrived, departed, admitted, removed, known, alive,
        unknown, files, headers, closed, epoch, proof, cleanup, unsafeCommit, unsafeDeletion>>

Reply ==
    /\ running /\ phase = "accepted" /\ requiredHandoff /\ replyGeneration = 0
    /\ replyGeneration' = generation
    /\ UNCHANGED <<running, phase, requiredHandoff, generation, durableHandoff,
        obligations, arrived, departed, admitted, removed, known, alive, unknown,
        files, headers, closed, epoch, proof, cleanup, unsafeCommit, unsafeDeletion>>

ReplaceIncarnation ==
    /\ running /\ ~departed /\ generation = 1
    /\ generation' = 2
    /\ UNCHANGED <<running, phase, requiredHandoff, replyGeneration, durableHandoff,
        obligations, arrived, departed, admitted, removed, known, alive, unknown,
        files, headers, closed, epoch, proof, cleanup, unsafeCommit, unsafeDeletion>>

(* saveHandoff is synchronous and fsynced before the SQLite departure marker.
   The answer's incarnation, or admission incarnation for no-handoff, must
   still match. Other snapshot fields are held fixed in this small model. *)
Commit ==
    /\ running /\ phase = "accepted" /\ ~obligations
    /\ IF requiredHandoff THEN replyGeneration = generation ELSE generation = 1
    /\ durableHandoff' = requiredHandoff
    /\ departed' = TRUE /\ admitted' = FALSE /\ phase' = "delivered"
    /\ unsafeCommit' = obligations
    /\ UNCHANGED <<running, requiredHandoff, replyGeneration, generation, obligations, arrived,
        removed, known, alive, unknown, files, headers, closed, epoch, proof,
        cleanup, unsafeDeletion>>

Refuse ==
    /\ running /\ phase = "accepted"
    /\ obligations \/ (requiredHandoff /\ replyGeneration # 0 /\ replyGeneration # generation)
        \/ (~requiredHandoff /\ generation # 1)
    /\ phase' = "failed"
    /\ UNCHANGED <<running, requiredHandoff, replyGeneration, generation, durableHandoff,
        obligations, arrived, departed, admitted, removed, known, alive, unknown,
        files, headers, closed, epoch, proof, cleanup, unsafeCommit, unsafeDeletion>>

(* Closing/ending an incarnation does not prove its OS host has exited. *)
CloseReceipt ==
    /\ running /\ departed /\ ~closed /\ closed' = TRUE
    /\ UNCHANGED <<running, phase, requiredHandoff, replyGeneration, generation,
        durableHandoff, obligations, arrived, departed, admitted, removed, known,
        alive, unknown, files, headers, epoch, proof, cleanup, unsafeCommit, unsafeDeletion>>

WriterExits(w) ==
    /\ w \in alive /\ alive' = alive \ {w}
    /\ UNCHANGED <<running, phase, requiredHandoff, replyGeneration, generation,
        durableHandoff, obligations, arrived, departed, admitted, removed, known,
        unknown, files, headers, closed, epoch, proof, cleanup, unsafeCommit, unsafeDeletion>>

ResolveProcessKnowledge ==
    /\ unknown # {} /\ unknown' = {}
    /\ UNCHANGED <<running, phase, requiredHandoff, replyGeneration, generation,
        durableHandoff, obligations, arrived, departed, admitted, removed, known,
        alive, files, headers, closed, epoch, proof, cleanup, unsafeCommit, unsafeDeletion>>

(* rejectDepartureHello records a narrow producer obligation, never a new
   person. Its journal event invalidates every in-flight cleanup watermark.
   The same action is allowed after an earlier truthful applied receipt. *)
LateHello ==
    /\ running /\ departed /\ "late" \notin known
    /\ known' = known \cup {"late"} /\ alive' = alive \cup {"late"}
    /\ files' = files \cup {"late"} /\ epoch' = epoch + 1
    /\ UNCHANGED <<running, phase, requiredHandoff, replyGeneration, generation,
        durableHandoff, obligations, arrived, departed, admitted, removed, unknown,
        headers, closed, proof, cleanup, unsafeCommit, unsafeDeletion>>

BeginCleanup ==
    /\ running /\ departed /\ cleanup = "none"
    /\ proof' = epoch /\ cleanup' = "checking"
    /\ UNCHANGED <<running, phase, requiredHandoff, replyGeneration, generation,
        durableHandoff, obligations, arrived, departed, admitted, removed, known,
        alive, unknown, files, headers, closed, epoch, unsafeCommit, unsafeDeletion>>

(* stopDepartureWriters: unknown identity and a live observed writer block.
   The model includes natural exits; process/pane signal mechanics are out
   of scope. PID/start-time identities are stable writer keys here. *)
ProveWritersStopped ==
    /\ running /\ cleanup = "checking" /\ proof = epoch
    /\ (alive \cup unknown) \cap known = {}
    /\ cleanup' = "files"
    /\ UNCHANGED <<running, phase, requiredHandoff, replyGeneration, generation,
        durableHandoff, obligations, arrived, departed, admitted, removed, known,
        alive, unknown, files, headers, closed, epoch, proof, unsafeCommit, unsafeDeletion>>

(* removeDepartureFiles verifies a session header and rechecks ownership
   after its asynchronous read, immediately before each synchronous unlink. *)
Unlink(w) ==
    /\ running /\ cleanup = "files" /\ proof = epoch
    /\ w \in files /\ w \in headers
    /\ files' = files \ {w}
    /\ unsafeDeletion' = (unsafeDeletion \/ w \in alive \cup unknown)
    /\ UNCHANGED <<running, phase, requiredHandoff, replyGeneration, generation,
        durableHandoff, obligations, arrived, departed, admitted, removed, known,
        alive, unknown, headers, closed, epoch, proof, cleanup, unsafeCommit>>

RepairHeader(w) ==
    /\ w \in files /\ w \notin headers /\ headers' = headers \cup {w}
    /\ UNCHANGED <<running, phase, requiredHandoff, replyGeneration, generation,
        durableHandoff, obligations, arrived, departed, admitted, removed, known,
        alive, unknown, files, closed, epoch, proof, cleanup, unsafeCommit, unsafeDeletion>>

RetryCleanup ==
    /\ running /\ cleanup # "none" /\ proof # epoch
    /\ cleanup' = "none" /\ proof' = 0
    /\ UNCHANGED <<running, phase, requiredHandoff, replyGeneration, generation,
        durableHandoff, obligations, arrived, departed, admitted, removed, known,
        alive, unknown, files, headers, closed, epoch, unsafeCommit, unsafeDeletion>>

(* The private-record transaction and terminal receipt have no intervening
   await. Files already unlinked across a crash are harmless on retry. *)
RemoveAndApply ==
    /\ running /\ cleanup = "files" /\ proof = epoch /\ files = {}
    /\ removed' = TRUE /\ phase' = "applied" /\ cleanup' = "none" /\ proof' = 0
    /\ UNCHANGED <<running, requiredHandoff, replyGeneration, generation,
        durableHandoff, obligations, arrived, departed, admitted, known, alive,
        unknown, files, headers, closed, epoch, unsafeCommit, unsafeDeletion>>

Crash ==
    /\ running /\ running' = FALSE /\ cleanup' = "none" /\ proof' = 0
    /\ UNCHANGED <<phase, requiredHandoff, replyGeneration, generation,
        durableHandoff, obligations, arrived, departed, admitted, removed, known,
        alive, unknown, files, headers, closed, epoch, unsafeCommit, unsafeDeletion>>

Restart ==
    /\ ~running /\ running' = TRUE
    /\ phase' = IF ~departed /\ phase = "accepted" THEN "failed" ELSE phase
    /\ UNCHANGED <<requiredHandoff, replyGeneration, generation, durableHandoff,
        obligations, arrived, departed, admitted, removed, known, alive, unknown,
        files, headers, closed, epoch, proof, cleanup, unsafeCommit, unsafeDeletion>>

Next == Accept \/ ArriveWork \/ FinishWork \/ Reply \/ ReplaceIncarnation \/ Commit
        \/ Refuse \/ CloseReceipt \/ ResolveProcessKnowledge \/ LateHello
        \/ BeginCleanup \/ ProveWritersStopped \/ RetryCleanup \/ RemoveAndApply
        \/ Crash \/ Restart \/ (\E w \in Writers : WriterExits(w) \/ Unlink(w) \/ RepairHeader(w))
Spec == Init /\ [][Next]_vars

TypeOK ==
    /\ running \in BOOLEAN /\ phase \in {"idle", "accepted", "delivered", "failed", "applied"}
    /\ requiredHandoff \in BOOLEAN /\ replyGeneration \in 0..2 /\ generation \in 1..2
    /\ durableHandoff \in BOOLEAN /\ obligations \in BOOLEAN /\ arrived \in BOOLEAN
    /\ departed \in BOOLEAN /\ admitted \in BOOLEAN /\ removed \in BOOLEAN
    /\ known \subseteq Writers /\ alive \subseteq known /\ unknown \subseteq known
    /\ files \subseteq known /\ headers \subseteq Writers /\ closed \in BOOLEAN
    /\ epoch \in 1..2 /\ proof \in 0..2 /\ cleanup \in {"none", "checking", "files"}
    /\ unsafeCommit \in BOOLEAN /\ unsafeDeletion \in BOOLEAN
NoCommitWithWork == ~unsafeCommit
NoMissingHandoff == (departed /\ requiredHandoff) => durableHandoff
NoReopen == departed => ~admitted
NoUnsafeDeletion == ~unsafeDeletion
CompletionHasCleanup == (phase = "applied") => removed
=============================================================================
