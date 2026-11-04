--------------------------- MODULE ProcessGroup ----------------------------
(* toolchain.ts runProcess, as built. The child starts in its own process
   group (detached). A time limit or an abort calls stop(): SIGTERM to the
   group and an escalation timer that sends SIGKILL after the grace period.
   The call waits for the child's close event, which needs the child to exit
   and every holder of its stdout/stderr pipes to close them, or, once the child
   has exited, one grace period, after which the call destroys its ends of the
   pipes (ReleasePipesAfterExit; FALSE models the earlier code, which waited
   for close alone). Then stopGroup()
   waits the group out: SIGTERM, SIGKILL after the grace period, and gives up
   one grace period later. The time-limit timer is cleared as soon as the
   child closes (ClearTimerOnClose; FALSE models the earlier code, which kept
   it running until the finally block). The escalation timer is cleared in
   the finally block.
   A descendant may hold the pipes or redirect them, any process may ignore
   SIGTERM, and a descendant may be unkillable (stuck in uninterruptible
   sleep); SIGKILL ends every other process. *)
EXTENDS Naturals

CONSTANTS WithTimeLimit, ClearTimerOnClose, ReleasePipesAfterExit
VARIABLES leader, desc, descPipes, ignoresTerm, unkillable, phase, timedOut, aborted,
          escalation, sg, timerBeforeClose
vars == <<leader, desc, descPipes, ignoresTerm, unkillable, phase, timedOut, aborted,
          escalation, sg, timerBeforeClose>>

Procs == {"leader", "desc"}

Init ==
    /\ leader = "run" /\ desc = "none"
    /\ descPipes \in BOOLEAN
    /\ ignoresTerm \in [Procs -> BOOLEAN]
    /\ unkillable \in BOOLEAN
    /\ phase = "waiting"
    /\ timedOut = FALSE /\ aborted = FALSE
    /\ escalation = "none" /\ sg = "idle"
    /\ timerBeforeClose = FALSE

Running(p) == IF p = "leader" THEN leader = "run" ELSE desc = "run"
GroupAlive == leader = "run" \/ desc = "run"
Active == phase \in {"waiting", "stopping"}

(* SIGTERM to the group: processes that do not ignore it exit. *)
TermGroup ==
    /\ leader' = IF leader = "run" /\ ~ignoresTerm["leader"] THEN "exited" ELSE leader
    /\ desc' = IF desc = "run" /\ ~ignoresTerm["desc"] THEN "exited" ELSE desc

KillGroup ==
    /\ leader' = IF leader = "run" THEN "exited" ELSE leader
    /\ desc' = IF desc = "run" /\ ~unkillable THEN "exited" ELSE desc

LeaderFinishes ==
    /\ leader = "run" /\ leader' = "exited"
    /\ UNCHANGED <<desc, descPipes, ignoresTerm, unkillable, phase, timedOut, aborted, escalation, sg, timerBeforeClose>>

Spawn ==
    /\ leader = "run" /\ desc = "none" /\ desc' = "run"
    /\ UNCHANGED <<leader, descPipes, ignoresTerm, unkillable, phase, timedOut, aborted, escalation, sg, timerBeforeClose>>

DescFinishes ==
    /\ desc = "run" /\ desc' = "exited"
    /\ UNCHANGED <<leader, descPipes, ignoresTerm, unkillable, phase, timedOut, aborted, escalation, sg, timerBeforeClose>>

(* stop(): SIGTERM now, SIGKILL when the escalation timer fires. *)
Stop ==
    /\ TermGroup
    /\ escalation' = IF escalation = "none" THEN "armed" ELSE escalation

TimerFires ==
    /\ WithTimeLimit /\ ~timedOut
    /\ IF ClearTimerOnClose THEN phase = "waiting" ELSE Active
    /\ timedOut' = TRUE
    /\ timerBeforeClose' = (phase = "waiting")
    /\ Stop
    /\ UNCHANGED <<descPipes, ignoresTerm, unkillable, phase, aborted, sg>>

Abort ==
    /\ Active /\ ~aborted
    /\ aborted' = TRUE
    /\ Stop
    /\ UNCHANGED <<descPipes, ignoresTerm, unkillable, phase, timedOut, sg, timerBeforeClose>>

EscalationFires ==
    /\ escalation = "armed" /\ phase # "done"
    /\ escalation' = "fired"
    /\ KillGroup
    /\ UNCHANGED <<descPipes, ignoresTerm, unkillable, phase, timedOut, aborted, sg, timerBeforeClose>>

(* close: the leader exited and nobody else holds its pipes. stopGroup() then
   runs in the same microtask chain, before any timer: it returns at once when
   the group is gone, or sends SIGTERM and starts polling. *)
Close ==
    /\ phase = "waiting" /\ leader = "exited"
    /\ ~(desc = "run" /\ descPipes) \/ ReleasePipesAfterExit
    /\ IF GroupAlive
          THEN /\ phase' = "stopping" /\ sg' = "term" /\ TermGroup
          ELSE /\ phase' = "done" /\ UNCHANGED <<sg, leader, desc>>
    /\ UNCHANGED <<descPipes, ignoresTerm, unkillable, timedOut, aborted, escalation, timerBeforeClose>>

(* stopGroup() polling: SIGKILL at killAt, give up at killAt + grace. *)
StopGroupPoll ==
    /\ phase = "stopping" /\ sg \in {"term", "kill"}
    /\ ~GroupAlive
    /\ phase' = "done"
    /\ UNCHANGED <<leader, desc, descPipes, ignoresTerm, unkillable, timedOut, aborted, escalation, sg, timerBeforeClose>>

StopGroupKill ==
    /\ phase = "stopping" /\ sg = "term" /\ GroupAlive
    /\ sg' = "kill" /\ KillGroup
    /\ UNCHANGED <<descPipes, ignoresTerm, unkillable, phase, timedOut, aborted, escalation, timerBeforeClose>>

StopGroupGiveUp ==
    /\ phase = "stopping" /\ sg = "kill" /\ GroupAlive
    /\ phase' = "done"
    /\ UNCHANGED <<leader, desc, descPipes, ignoresTerm, unkillable, timedOut, aborted, escalation, sg, timerBeforeClose>>

Next ==
    \/ LeaderFinishes \/ Spawn \/ DescFinishes
    \/ TimerFires \/ Abort \/ EscalationFires \/ Close
    \/ StopGroupPoll \/ StopGroupKill \/ StopGroupGiveUp

Fairness ==
    /\ WF_vars(TimerFires) /\ WF_vars(EscalationFires) /\ WF_vars(Close)
    /\ WF_vars(StopGroupPoll) /\ WF_vars(StopGroupKill)
    /\ WF_vars(StopGroupGiveUp)

Spec == Init /\ [][Next]_vars /\ Fairness

TypeOK ==
    /\ leader \in {"run", "exited"} /\ desc \in {"none", "run", "exited"}
    /\ phase \in {"waiting", "stopping", "done"}
    /\ escalation \in {"none", "armed", "fired"} /\ sg \in {"idle", "term", "kill"}

(* When the call returns or throws, no process of the group is running, unless
   an unkillable one outlived SIGKILL and the call gave up on it. *)
SettledGroupGone == phase = "done" => (~GroupAlive \/ (unkillable /\ sg = "kill"))

(* timedOut means the time limit fired before the child closed. *)
TimedOutMeansUnfinished == timedOut => timerBeforeClose

(* With a time limit, the call always settles, whatever the processes do. *)
Settles == WithTimeLimit => <>(phase = "done")

(* After an abort, the call always settles. *)
AbortSettles == aborted ~> (phase = "done")
=============================================================================
