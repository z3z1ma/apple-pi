---------------------------- MODULE ReviewWait -----------------------------
(* read_review and review_code with wait: settledReview in
   components/code-review/src/tools.ts polls the job's recorded state once a
   second and returns only when it is completed, incomplete, failed,
   cancelled, no-changes or interrupted.

   The job (review-jobs.ts) runs its passes, the planner first; each pass is
   one attempt (review-attempt.ts) retried once. A planner that fails twice
   fails the job; another pass that fails twice makes it incomplete.

   An attempt starts a temporary reviewer peer and waits for its turn. The
   peer may finish its turn, stall (its provider stream never ends: no
   activity reaches the runtime), or freeze (its process stops responding,
   SIGTERM included). The silence watchdog (WatchdogOn) closes the
   attempt's program when the reviewer shows no activity for the silence
   limit; closing discards the peer with SIGTERM, then SIGKILL after a grace
   period (KillEscalation). Its bridge then disconnects, which fails the
   pending turn, and the attempt fails.

   The runtime may crash a bounded number of times. Its headless reviewers
   lose their pipes and exit unless frozen; the job stays recorded as
   running. A live session's bridge restarts the runtime, whose recovery
   marks the job interrupted, discards abandoned scopes, waits for that
   cleanup and queues it again.

   Assumption, not checked: a turn that keeps showing activity eventually
   ends (PeerFinish is weakly fair while the turn is active). *)
EXTENDS Naturals

CONSTANTS Passes, MaxCrashes, WatchdogOn, KillEscalation
VARIABLES job, pass, tries, failedPass, turn, peer, termed, runtime, crashes, waiter
vars == <<job, pass, tries, failedPass, turn, peer, termed, runtime, crashes, waiter>>

Settled == {"completed", "incomplete", "failed", "interrupted"}

Init ==
    /\ job = "queued" /\ pass = 1 /\ tries = 0 /\ failedPass = FALSE
    /\ turn = "idle" /\ peer = "none" /\ termed = FALSE
    /\ runtime = "up" /\ crashes = 0 /\ waiter = "waiting"

Claim ==
    /\ runtime = "up" /\ job = "queued"
    /\ job' = "running" /\ pass' = 1 /\ tries' = 0 /\ failedPass' = FALSE
    /\ UNCHANGED <<turn, peer, termed, runtime, crashes, waiter>>

Launch ==
    /\ runtime = "up" /\ job = "running" /\ pass <= Passes
    /\ turn = "idle" /\ peer \in {"none", "dead"} /\ tries < 2
    /\ turn' = "active" /\ peer' = "alive" /\ termed' = FALSE /\ tries' = tries + 1
    /\ UNCHANGED <<job, pass, failedPass, runtime, crashes, waiter>>

PeerFinish ==
    /\ turn = "active" /\ peer = "alive"
    /\ turn' = "finished"
    /\ UNCHANGED <<job, pass, tries, failedPass, peer, termed, runtime, crashes, waiter>>

PeerStall ==
    /\ turn = "active" /\ peer = "alive"
    /\ turn' = "stalled"
    /\ UNCHANGED <<job, pass, tries, failedPass, peer, termed, runtime, crashes, waiter>>

PeerFreeze ==
    /\ peer = "alive"
    /\ peer' = "frozen"
    /\ turn' = IF turn = "active" THEN "stalled" ELSE turn
    /\ UNCHANGED <<job, pass, tries, failedPass, termed, runtime, crashes, waiter>>

Watchdog ==
    /\ WatchdogOn /\ runtime = "up" /\ turn = "stalled"
    /\ turn' = "closing"
    /\ UNCHANGED <<job, pass, tries, failedPass, peer, termed, runtime, crashes, waiter>>

(* Discarding a peer: the runtime sends SIGTERM once, which a responsive
   peer obeys; with KillEscalation it sends SIGKILL after the grace period. *)
Discarding == turn \in {"closing", "releasing"} \/ (job = "interrupted" /\ peer \in {"alive", "frozen"})

Terminate ==
    /\ runtime = "up" /\ Discarding /\ peer \in {"alive", "frozen"} /\ ~termed
    /\ termed' = TRUE
    /\ peer' = IF peer = "alive" THEN "dead" ELSE "frozen"
    /\ UNCHANGED <<job, pass, tries, failedPass, turn, runtime, crashes, waiter>>

Kill ==
    /\ KillEscalation /\ runtime = "up" /\ Discarding /\ termed /\ peer = "frozen"
    /\ peer' = "dead"
    /\ UNCHANGED <<job, pass, tries, failedPass, turn, termed, runtime, crashes, waiter>>

NextPass ==
    /\ pass' = pass + 1 /\ tries' = 0 /\ turn' = "idle"

(* After a result the attempt closes its program, which discards the peer. *)
Release ==
    /\ runtime = "up" /\ job = "running" /\ turn = "finished"
    /\ turn' = "releasing"
    /\ UNCHANGED <<job, pass, tries, failedPass, peer, termed, runtime, crashes, waiter>>

AttemptCompletes ==
    /\ runtime = "up" /\ job = "running" /\ turn = "releasing" /\ peer = "dead"
    /\ NextPass
    /\ UNCHANGED <<job, failedPass, peer, termed, runtime, crashes, waiter>>

AttemptFails ==
    /\ runtime = "up" /\ job = "running" /\ turn = "closing" /\ peer = "dead"
    /\ IF tries < 2
          THEN /\ turn' = "idle" /\ UNCHANGED <<job, pass, tries, failedPass>>
          ELSE IF pass = 1
               THEN /\ job' = "failed" /\ turn' = "idle" /\ UNCHANGED <<pass, tries, failedPass>>
               ELSE /\ NextPass /\ failedPass' = TRUE /\ UNCHANGED job
    /\ UNCHANGED <<peer, termed, runtime, crashes, waiter>>

Finish ==
    /\ runtime = "up" /\ job = "running" /\ pass > Passes
    /\ job' = IF failedPass THEN "incomplete" ELSE "completed"
    /\ UNCHANGED <<pass, tries, failedPass, turn, peer, termed, runtime, crashes, waiter>>

Crash ==
    /\ runtime = "up" /\ crashes < MaxCrashes
    /\ runtime' = "down" /\ crashes' = crashes + 1
    /\ peer' = IF peer = "frozen" THEN "frozen" ELSE IF peer = "none" THEN "none" ELSE "dead"
    /\ turn' = "idle" /\ termed' = FALSE
    /\ UNCHANGED <<job, pass, tries, failedPass, waiter>>

Restart ==
    /\ runtime = "down"
    /\ runtime' = "up"
    /\ job' = IF job \in {"queued", "running"} THEN "interrupted" ELSE job
    /\ UNCHANGED <<pass, tries, failedPass, turn, peer, termed, crashes, waiter>>

Resume ==
    /\ runtime = "up" /\ job = "interrupted" /\ peer \in {"none", "dead"}
    /\ job' = "queued"
    /\ UNCHANGED <<pass, tries, failedPass, turn, peer, termed, runtime, crashes, waiter>>

Poll ==
    /\ waiter = "waiting" /\ job \in Settled
    /\ waiter' = "returned"
    /\ UNCHANGED <<job, pass, tries, failedPass, turn, peer, termed, runtime, crashes>>

System == Claim \/ Launch \/ Watchdog \/ Terminate \/ Kill \/ Release \/ AttemptCompletes \/ AttemptFails
          \/ Finish \/ Restart \/ Resume \/ Poll
Next == System \/ PeerFinish \/ PeerStall \/ PeerFreeze \/ Crash

Spec == Init /\ [][Next]_vars
        /\ WF_vars(Claim) /\ WF_vars(Launch) /\ WF_vars(Watchdog) /\ WF_vars(Terminate)
        /\ WF_vars(Kill) /\ WF_vars(Release) /\ WF_vars(AttemptCompletes) /\ WF_vars(AttemptFails) /\ WF_vars(Finish)
        /\ WF_vars(Restart) /\ WF_vars(Resume) /\ WF_vars(Poll) /\ WF_vars(PeerFinish)

TypeOK ==
    /\ job \in {"queued", "running", "completed", "incomplete", "failed", "interrupted"}
    /\ pass \in 1..(Passes + 1) /\ tries \in 0..2 /\ failedPass \in BOOLEAN
    /\ turn \in {"idle", "active", "stalled", "finished", "closing", "releasing"}
    /\ peer \in {"none", "alive", "frozen", "dead"} /\ termed \in BOOLEAN
    /\ runtime \in {"up", "down"} /\ crashes \in 0..MaxCrashes
    /\ waiter \in {"waiting", "returned"}

(* The wait ends: the review reaches a settled state the waiter sees. *)
WaitEnds == <>(waiter = "returned")
=============================================================================
