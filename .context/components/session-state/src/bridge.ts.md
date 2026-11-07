## file

--incorporate remains registered even with the bridge disabled, matching Pi's flag-discovery boundary. A current bridge reports interactive mode, the flag and an opaque process-lifetime launch token; admission consumes the flag once per token after resolving the recorded tree. The token and initial process-start estimate survive SDK replacement/reload on process, so a clock correction cannot create fresh startup authority. A missing token leaves recorded lifetime unchanged. A retained legacy/unknown gate withholds both strengthened capability and launch token. The first bridge binding must also be startup: a first installation during reload caches an unknown launch permanently, even if there was no earlier latch. Hot-loading new code into an older process cannot mint fresh startup authority or certify unobserved earlier preparation. A seeded legacy-launch native control reproduces that upgrade boundary with zero provider requests. /incorporate resolves the current root and sends the fixed mutation; the runtime rechecks it so a stale selected head cannot incorporate a later merge target.

Pi's host disposal emits quit for RPC stdin EOF and SIGTERM as well as ordinary exit. interactive metadata alone also includes signal-driven window closing. The signal-order observer supplies deliberate non-signal provenance; a runtime close supplies the exact executed close command ID instead. Old/missing/uncertain provenance keeps the organization, and a delivered historical close never substitutes for execution. The reason string alone is insufficient. Reload/new/resume/fork are not dissolution intent. A runtime restart remains the owner's action; missing close provenance stays conservative.
Why: installed host source established this shared disposal path, not a fresh physical exit experiment. Inferring destructive intent from its reason string would conflate operator closing with headless parent/runtime loss.
Coupled: components/session-state/src/organization-lifetime.ts, components/session-state/src/protocol.ts, components/session-state/src/runtime.ts
Verify: components/session-state/tests/organization-lifetime.test.ts, tests/package-load.mjs

Only a program-owned fork at startup records its identity-bound inherited-history marker before hello. sessionCost counts new entries after that marker on every hello/settlement; reloads retain it and do not reset genuine work to a new baseline. Report optional forkOffset with hello for the runtime's log boundary. A fresh temp has no parent transcript/marker and keeps its prior zero-baseline accounting. A legacy already-running bridge without a marker remains readable and does not invent one on reload; new forks require current bridge code.
Why: bridge cost previously summed copied assistant usage, and the program launch's deliberate zero event made that historical spend look newly incurred.
Coupled: components/session-state/src/program-fork.ts
Verify: components/session-state/tests/peer-history.test.ts, components/session-state/tests/review-workers.test.ts

Git context distinguishes a confirmed non-repository (null) from failed inspection (undefined, retaining the previous observation). The common Git directory identifies the repository across linked worktrees. Extension inventory includes tool/command registrants only; hook-only extensions are invisible to Pi's listing. Flag registration remains present even when the bridge is switched off, since Pi rejects an unknown launch flag.
Why: absence and unavailable observations are different facts, and the host's inventory and command parser set the bridge's information boundary.

Transcript indexing is append-only; reconnect resends indexed rows and the runtime deduplicates them. Mail is acknowledged applied only after transcript persistence, which Pi delays until a user or assistant entry exists. Idle transcript appends are polled, and context usage is sampled after the turn is saved. A waited-out review milestone stays as a pointer because its complete result is already in the wait response.
Why: queue handover and message_end do not prove durable transcript storage; acknowledging sooner could lose mail on process exit or report stale usage.

A live-session input gate wraps the public SDK entry methods before input handlers, extension commands or auth can await while the host still looks idle. Reuse the existing liveSession binding rather than infer preparation from agent_start or replace the SDK. The entry wrappers belong to each AgentSession, while both in-flight accounting and the seal survive across the process's replacement objects and reload; hello carries its ticket so the runtime invalidates old proofs before releasing it. Applying quiesce seals synchronously before acknowledging. Only an adapter with launch-wide scope advertises the strengthened capability. Missing bindings and retained legacy adapters grant no proof, and the runtime waits conservatively.

Only startup replayed mail rides the next turn; live mail can still start work. Command delivery verifies that the receiving link is still current. Abort completion waits for run settlement (or out-of-run compaction completion); shutdown stops an active turn before asking Pi to exit. An unreachable runtime cannot block shutdown indefinitely, so the dropped close notice is reported. Switched/resumed/forked sessions retain the prior file as the process's old-session reference. Role resolution runs before hello and manager-tool reconciliation.
Why: link replacement, queued inputs and asynchronous host model/abort failures have distinct lifetimes; an accepted input is not completed execution.

Pi's `agent_start` is a loop boundary: `agent.continue()` can emit it again inside the same high-level run. `before_agent_start` supplies flattened `messageType` plus `message` or `prompt`/`images`; `agent_settled` marks final settlement. When observing high-level runs, reserve identity at preparation, activate on the first loop start and retain that identity through continuations. Preparation that never executes contributes no execution time; missing boundaries remain explicit unknowns. Retain typed input references rather than bodies or guessed timestamp/text matches.
Why: the introspection audit checked these boundaries in installed Pi 1.4.0 and published Pi 1.2.0 source. Counting loop starts would split one response into several runs; command delivery and transcript persistence also occur at different times from input consumption. The observer and projection must preserve this host boundary together; source inspection alone is not executed lifecycle proof. See [[session-log-analysis#Incoming-mail time attribution]].
Coupled: components/session-state/src/run-observation.ts, components/session-state/src/execution-inspection.ts, components/session-state/src/protocol.ts, components/session-state/src/runtime.ts, components/session-state/src/mail.ts, components/session-state/src/peer-turns.ts
Verify: components/session-state/tests/run-observation.test.ts, components/session-state/tests/execution-inspection.test.ts, components/session-state/tests/mail.test.ts

Mail forwarding carries the runtime's optional conversation kind and exact message reference to the transcript/rendering boundary. Legacy absence stays unknown; a subject or name cannot establish conversation kind. This lets a selected channel notification be answered without retrieving or acknowledging unrelated history.
Coupled: components/session-state/src/mail.ts, components/session-state/src/protocol.ts
Verify: components/session-state/tests/mail-render.test.ts, components/session-state/tests/communication-tools.test.ts

A program-created person's hello carries launch ownership identifiers only while the program environment variables are present. Native transcript resume retains its UUID but can lose that environment and emit an ordinary hello. The runtime therefore checks durable temporary identity independently of the flags, requires valid live scope/owner/creation-parent matching, and rejects late or unflagged disposed identities before person/incarnation/facts writes. Retaining the transcript is not permission to reopen its temporary identity as a lasting root. These peers skip routine close mail: their caller consumes the correlated result, while ordinary mail and task threads retain their normal behavior.
Coupled: components/session-state/src/runtime.ts, components/session-state/src/program-client.ts
Verify: components/session-state/tests/peer-history.test.ts, components/session-state/tests/program-peers.test.ts, components/session-state/tests/peer-turns.test.ts

A tool that blocks on the operator publishes its own prompt fact: `ask_user_question` through the questionnaire channel, and the sign-off pages through the operator-page channel (`kind: "sign-off"`, with the page title). Each keeps the session "asking the operator" until its `closed` promise resolves, and Pi's own dialogs (`ui_prompt_start`/`end`) leave the prompt alone while one is open. When several are open, closing one shows the latest still open.
Why: a session waiting minutes on a browser verdict otherwise reads as working in the sidebar, the status line and Workplace, so nobody knows it needs the operator.
Coupled: components/shared/src/operator-page-events.ts, components/browser-pages/src/index.ts, components/ask-user-question/src/index.ts
Verify: components/session-state/tests/operator-pages.test.ts, components/session-state/tests/questionnaires.test.ts

## symbol:StateLink.close

A link closed without a reason (a reload, or a new `session_start` replacing the link) sends no shutdown, so the next bridge in the same process resumes the same incarnation; only a real session end sends one.
Why: a shutdown ends the incarnation, so sending it on reload recorded a fake process exit and a new generation for the same pid.
Verify: components/session-state/tests/runtime.test.ts

A link whose connection drops starts a runtime once and keeps reconnecting. Tests must end faux sessions with `session_shutdown` (the `close` helper), not `dispose` alone.
Why: a disposed session's link stays connected; when the test stops the runtime, the link starts a new one into a directory the test is deleting, leaving a stray daemon.
Coupled: components/session-state/tests/helpers.ts

## symbol:StateLink.turnProgress

Program progress is a replaceable snapshot per command. While the socket is backed up, keep only its newest snapshot; a terminal result drops that snapshot. Disconnect clears transient progress and tells the peer-turn controller to stop its owned run, while ordinary work continues. A result belongs to the original waiting caller, so reconnecting cannot safely continue that request.
Coupled: components/session-state/src/peer-turns.ts, components/session-state/src/runtime.ts
Verify: components/session-state/tests/peer-turns.test.ts, components/session-state/tests/streaming.test.ts

## symbol:handedOver

Mail ids handed to Pi but not yet in the transcript live on `globalThis` per session id. They are cleared on every `session_start` except `reload`, and on every `agent_settled` that was not aborted.
Why: Pi's agent queue survives an extension reload, and the reloaded bridge receives the same unapplied mail again; an empty set would queue it twice. A completed run has recorded every queued steer; an aborted run may have discarded its queue (Escape) or kept it (RPC abort), so its ids wait for the next completed run.
Verify: components/session-state/tests/mail.test.ts

## symbol:StateLink.replyDelta

Reply deltas are transient: dropped while disconnected, never kept for a reconnect, and coalesced into one held delta while the socket needs draining. `send` flushes the held delta before any other message, so a stream's text always precedes its `reply_end`. The stream ends at `turn_end`, after `indexNew`, so the `messageEntryId` a client receives is already indexed.
Why: Pi's `message_update` callback must never wait, and a runtime that stops reading would otherwise queue a line per delta in the Pi process.
Coupled: components/session-state/src/runtime.ts
Verify: components/session-state/tests/bridge-backpressure.test.ts

## symbol:heldFollowUps

A `follow_up` that reaches a busy session is held by the bridge, not handed to Pi's queue, until `agent_settled`: then the first starts the next turn and the rest queue behind it as Pi follow-ups, each reported applied as it is handed over. A `withdraw` naming a held follow-up removes it and fails it as `withdrawn`. An aborted run fails the held ones as not sent rather than starting work the operator just stopped. Held follow-ups count in the reported `queue`, and live on `globalThis` per session id so an extension reload keeps them.
Why: the operator asked to take back a message before the agent reads it; Pi's queue cannot be edited from an extension, so the only withdrawable place is before the hand-over.
Coupled: components/session-state/src/protocol.ts, apps/agent-workplace/src/backend/instructions.ts, apps/agent-workplace/web/overlay/conversation/actions.tsx
Verify: components/session-state/tests/commands.test.ts, apps/agent-workplace/tests/instruct.test.ts, apps/agent-workplace/tests/world-desk.test.ts
