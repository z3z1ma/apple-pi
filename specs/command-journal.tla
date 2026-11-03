-------------------------- MODULE CommandJournal --------------------------
EXTENDS Naturals, FiniteSets

CONSTANT Commands
ASSUME /\ IsFiniteSet(Commands) /\ Commands # {}

(* A communication command and its unbound mail child share a stable command
   identity, but have separate journal rows and receipts. See README.md for
   the implementation mapping, abstraction boundaries and finite instance. *)
VARIABLES stage, result, effects, outbox, mailStage, transcript, recordings,
          handed, phase, active, running, receipt, mailReceipt

vars == <<stage, result, effects, outbox, mailStage, transcript, recordings,
          handed, phase, active, running, receipt, mailReceipt>>

Stages == {"absent", "accepted", "delivered", "applied", "failed"}
Terminal(s) == s \in {"applied", "failed"}
Rank(s) == CASE s = "absent" -> 0 [] s = "accepted" -> 1
            [] s = "delivered" -> 2 [] OTHER -> 3

Init ==
    /\ stage = [c \in Commands |-> "absent"]
    /\ result = [c \in Commands |-> "none"]
    /\ effects = [c \in Commands |-> 0]
    /\ outbox = {}
    /\ mailStage = [c \in Commands |-> "absent"]
    /\ transcript = {}
    /\ recordings = [c \in Commands |-> 0]
    /\ handed = {}
    /\ phase = "idle"
    /\ active = "none"
    /\ running = TRUE
    /\ receipt = [c \in Commands |-> "absent"]
    /\ mailReceipt = [c \in Commands |-> "absent"]

(* Runtime.command: accepting the journal row is a durable write before any
   effect. Same-ID retry only observes the row; it never enters this action. *)
Accept(c) ==
    /\ running /\ phase = "idle" /\ stage[c] = "absent"
    /\ stage' = [stage EXCEPT ![c] = "accepted"]
    /\ UNCHANGED <<result, effects, outbox, mailStage, transcript, recordings,
                    handed, phase, active, running, receipt, mailReceipt>>

(* The synchronous SQLite transaction is a single writer. The phases expose
   crash points after each staged mutation, outbox and result write. None is
   durable until Commit; SQLite rolls all of them back on a crash. *)
Begin(c) ==
    /\ running /\ phase = "idle"
    /\ stage[c] = "accepted" /\ result[c] = "none"
    /\ active' = c /\ phase' = "effect"
    /\ UNCHANGED <<stage, result, effects, outbox, mailStage, transcript,
                    recordings, handed, running, receipt, mailReceipt>>

Write(nextPhase) ==
    /\ running
    /\ \/ /\ phase = "effect" /\ nextPhase = "outbox"
       \/ /\ phase = "outbox" /\ nextPhase = "result"
       \/ /\ phase = "result" /\ nextPhase = "commit"
    /\ phase' = nextPhase
    /\ UNCHANGED <<stage, result, effects, outbox, mailStage, transcript,
                    recordings, handed, active, running, receipt, mailReceipt>>

Commit ==
    /\ running /\ phase = "commit"
    /\ effects' = [effects EXCEPT ![active] = @ + 1]
    /\ result' = [result EXCEPT ![active] = active]
    /\ outbox' = outbox \cup {active}
    /\ mailStage' = [mailStage EXCEPT ![active] = "accepted"]
    /\ phase' = "idle" /\ active' = "none"
    /\ UNCHANGED <<stage, transcript, recordings, handed, running,
                    receipt, mailReceipt>>

Rollback ==
    /\ running /\ phase \in {"effect", "outbox", "result", "commit"}
    /\ phase' = "failed"
    /\ UNCHANGED <<stage, result, effects, outbox, mailStage, transcript,
                    recordings, handed, active, running, receipt, mailReceipt>>

ReportFailure ==
    /\ running /\ phase = "failed"
    /\ stage' = [stage EXCEPT ![active] = "failed"]
    /\ phase' = "idle" /\ active' = "none"
    /\ UNCHANGED <<result, effects, outbox, mailStage, transcript, recordings,
                    handed, running, receipt, mailReceipt>>

(* Runtime.communicationCommand's result shortcut is also startup replay.
   A committed effect gets its terminal stage without running Begin again. *)
Complete(c) ==
    /\ running /\ phase = "idle"
    /\ stage[c] = "accepted" /\ result[c] # "none"
    /\ stage' = [stage EXCEPT ![c] = "applied"]
    /\ UNCHANGED <<result, effects, outbox, mailStage, transcript, recordings,
                    handed, phase, active, running, receipt, mailReceipt>>

(* Runtime.hello replays pending mail. bridge.apply deduplicates both queued
   handover ids and ids already present in the durable Pi transcript. *)
Dispatch(c) ==
    /\ running /\ phase = "idle" /\ c \in outbox
    /\ mailStage[c] \in {"accepted", "delivered"}
    /\ handed' = handed \cup {c}
    /\ UNCHANGED <<stage, result, effects, outbox, mailStage, transcript,
                    recordings, phase, active, running, receipt, mailReceipt>>

Delivered(c) ==
    /\ running /\ phase = "idle" /\ c \in handed
    /\ mailStage[c] \in {"accepted", "delivered"}
    /\ mailStage' = [mailStage EXCEPT ![c] = "delivered"]
    /\ UNCHANGED <<stage, result, effects, outbox, transcript, recordings,
                    handed, phase, active, running, receipt, mailReceipt>>

(* This means recorded on disk, not merely put in Pi's queue. It can happen
   while the daemon is down. The bridge waits for a persisted conversation. *)
Record(c) ==
    /\ c \in handed /\ c \notin transcript
    /\ transcript' = transcript \cup {c}
    /\ recordings' = [recordings EXCEPT ![c] = @ + 1]
    /\ UNCHANGED <<stage, result, effects, outbox, mailStage, handed, phase,
                    active, running, receipt, mailReceipt>>

Acknowledge(c) ==
    /\ running /\ phase = "idle" /\ c \in handed /\ c \in transcript
    /\ mailStage[c] = "delivered"
    /\ mailStage' = [mailStage EXCEPT ![c] = "applied"]
    /\ handed' = handed \ {c}
    /\ UNCHANGED <<stage, result, effects, outbox, transcript, recordings,
                    phase, active, running, receipt, mailReceipt>>

FailMail(c) ==
    /\ running /\ phase = "idle" /\ c \in handed
    /\ mailStage[c] = "delivered" /\ c \notin transcript
    /\ mailStage' = [mailStage EXCEPT ![c] = "failed"]
    /\ handed' = handed \ {c}
    /\ UNCHANGED <<stage, result, effects, outbox, transcript, recordings,
                    phase, active, running, receipt, mailReceipt>>

(* Receipt sends and same-ID queries read committed stages. Sockets can lose
   any send; Observe is optional. A retry cannot mutate an operation. *)
Observe(c) ==
    /\ running /\ phase = "idle"
    /\ receipt' = [receipt EXCEPT ![c] = stage[c]]
    /\ mailReceipt' = [mailReceipt EXCEPT ![c] = mailStage[c]]
    /\ UNCHANGED <<stage, result, effects, outbox, mailStage, transcript,
                    recordings, handed, phase, active, running>>

Crash ==
    /\ running /\ running' = FALSE
    /\ phase' = "idle" /\ active' = "none"
    /\ UNCHANGED <<stage, result, effects, outbox, mailStage, transcript,
                    recordings, handed, receipt, mailReceipt>>

Restart ==
    /\ ~running /\ running' = TRUE
    /\ UNCHANGED <<stage, result, effects, outbox, mailStage, transcript,
                    recordings, handed, phase, active, receipt, mailReceipt>>

BridgeCrash ==
    /\ handed' = {}
    /\ UNCHANGED <<stage, result, effects, outbox, mailStage, transcript,
                    recordings, phase, active, running, receipt, mailReceipt>>

Next ==
    \/ \E c \in Commands : Accept(c) \/ Begin(c) \/ Complete(c) \/ Dispatch(c)
                            \/ Delivered(c) \/ Record(c) \/ Acknowledge(c)
                            \/ FailMail(c) \/ Observe(c)
    \/ \E p \in {"outbox", "result", "commit"} : Write(p)
    \/ Commit \/ Rollback \/ ReportFailure \/ Crash \/ Restart \/ BridgeCrash

Spec == Init /\ [][Next]_vars

TypeOK ==
    /\ stage \in [Commands -> Stages]
    /\ mailStage \in [Commands -> Stages]
    /\ receipt \in [Commands -> Stages]
    /\ mailReceipt \in [Commands -> Stages]
    /\ result \in [Commands -> Commands \cup {"none"}]
    /\ effects \in [Commands -> Nat] /\ recordings \in [Commands -> Nat]
    /\ outbox \subseteq Commands /\ transcript \subseteq Commands
    /\ handed \subseteq outbox /\ running \in BOOLEAN
    /\ phase \in {"idle", "effect", "outbox", "result", "commit", "failed"}
    /\ active \in Commands \cup {"none"}
    /\ (phase = "idle") = (active = "none")

NoCommandAppliedTwice == \A c \in Commands : effects[c] <= 1 /\ recordings[c] <= 1
NoLostAppliedResult == \A c \in Commands :
    /\ (stage[c] = "applied" => result[c] = c /\ effects[c] = 1)
    /\ (effects[c] = 1) = (result[c] = c)
    /\ (mailStage[c] = "applied" => c \in transcript)
AtomicPublication == \A c \in Commands :
    /\ (result[c] # "none") = (c \in outbox)
    /\ (mailStage[c] # "absent") = (c \in outbox)

(* These are transition properties, not tautological bounds on one state.
   Terminal rows never change branch. Replaying a committed result preserves
   effects, frozen result, outbox and transcript, even across repeated crashes. *)
ReceiptsMonotone == [][\A c \in Commands :
    /\ Rank(stage'[c]) >= Rank(stage[c])
    /\ Rank(mailStage'[c]) >= Rank(mailStage[c])
    /\ Rank(receipt'[c]) >= Rank(receipt[c])
    /\ Rank(mailReceipt'[c]) >= Rank(mailReceipt[c])
    /\ (Terminal(stage[c]) => stage'[c] = stage[c])
    /\ (Terminal(mailStage[c]) => mailStage'[c] = mailStage[c])
    /\ (Terminal(receipt[c]) => receipt'[c] = receipt[c])
    /\ (Terminal(mailReceipt[c]) => mailReceipt'[c] = mailReceipt[c])]_vars

ReplayIdempotent == [][\A c \in Commands : result[c] # "none" =>
    /\ effects'[c] = effects[c]
    /\ result'[c] = result[c]
    /\ c \in outbox']_vars

DurableTranscript == [][transcript \subseteq transcript']_vars
=============================================================================
