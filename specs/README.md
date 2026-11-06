# Lifecycle models

These are apple-pi's own formal models of its runtime and of its verification tools. They live in this repository and do not ship in the package. Check one with its tool (`tlc_check`, `alloy_check` or `lean_check` with the file's path), or run all of them with their tests:

```bash
npx vitest run tests/formal-verification.test.ts tests/lifecycle-models.test.ts tests/verification-models.test.ts --maxWorkers=1
```

## Waiting for a review

| Model | Engine | Claim |
| --- | --- | --- |
| `review-wait.tla` | TLC, with weak fairness | `read_review` with `wait` always returns: through runtime crashes (bounded) and restarts, reviewer turns that stall forever, and reviewer processes that ignore SIGTERM, every attempt fails or completes, each pass is retried once, and the job settles. It assumes a turn that keeps showing activity eventually ends. Turning off either the silence watchdog (`WatchdogOn`) or SIGKILL escalation (`KillEscalation`) gives a temporal violation; its test requires both. |

## Evidence-backed capabilities

| Model | Engine | Claim |
| --- | --- | --- |
| `capability-candidate.tla` | TLC, with weak fairness | Design model of one candidate under `roles/capability-steward.md`: nothing reaches the main line unless the operator approved that exact version; what reaches it was proven and challenged unbroken in that exact version; a declined candidate never reaches it; with bounded revisions every candidate closes. `KeepEvidenceOnRevise = TRUE` (a steward that keeps an old version's evidence after revising) violates `EvidenceForMerged`; its test requires that. The steward's discipline is prose in its role, not code: the pass covers the protocol, not an agent obeying it. |
| `program-comparison.tla` | TLC, with weak fairness | `runSample`/`comparePrograms` in `components/programs/src/compare.ts`, as built: whatever fails (worktree add, program open, the turn, an abort, close, removal), no worktree or temporary directory outlives its run, and no run starts while a peer of an earlier run may be alive. The two first drafts (`CleanupOnAddFailure`, `StopOnCloseFailure` set to FALSE) each violate one property. |
| `program-comparison.lean` | Lean | The comparison schedule gives both arms of every task exactly `samples` runs (`schedule_count`) and `2 * samples * tasks` runs in all (`schedule_length`); replay counting partitions jobs into evaluated and not evaluated (`replay_partition`) and counts only evaluated jobs as hits (`hits_are_evaluated`). Hand transcriptions; the order and counts are tied to the code by `program-peers.test.ts` and `replay.test.ts`. |

## The verification tools themselves

| Model | Engine | Claim |
| --- | --- | --- |
| `elan-publication.tla` | TLC, three processes that can crash anywhere | Publishing a staged elan install by `rename` never replaces a complete home; a call that returns has a complete home; a call fails only on an incomplete home it did not make. |
| `process-group.tla` | TLC, with weak fairness | `runProcess` in `toolchain.ts`: with a time limit or an abort the call always settles, even when a descendant ignores SIGTERM, leaves the group or keeps the pipes; when it settles, no killable process of its group is running; `timedOut` means the limit fired before the child finished. Two constants reproduce the earlier code (`ClearTimerOnClose`, `ReleasePipesAfterExit` set to FALSE); its test requires both to fail. |
| `lean-verdict.lean` | Lean | `runLean` and `summary` in `lean.ts`, every early return included, with each phase result as an input. `pass_sound`: a `pass` means every process exited 0 without a timeout, the diagnostics parsed with no error and no sorry warning, the audit report is valid, no declaration uses `sorryAx`, and every audited theorem (the named ones, or every theorem with a written one present) uses only toolchain-standard axioms. Proved for every possible run. |
| `alloy-decision.lean` | Lean | `execute`, `judge` and `runAlloy` in `alloy.ts`, for any number of commands. `pass_sound`: a `pass` means the listing, selection and model fingerprint held, every command ran with exit 0 and a valid solver receipt, every property check found no counterexample, every `expect` held, a property was checked and a run found an instance. A missed-expect exit 1 never reaches a `pass`. |
| `lean-trust.als` | Alloy | lean_check's trust boundary: every declaration a passing theorem depends on is replayed by the kernel or comes from the toolchain or a Lake package. `BeforeCoversEveryDependency` is the earlier replay set (the project's own modules only); its counterexample is a module elsewhere, such as a Lake path dependency, and the real tool did pass `theorem result : False` through one before the fix. |

The Lean and Alloy models are hand transcriptions of the TypeScript, not extractions: they prove the decisions sound as written and go stale when the code changes. The tools' own tests tie the transcriptions to the real behavior, including one regression test per counterexample.

The tool and the tests share `components/formal-verification/src/tlc.ts`. It pins [TLA+ tools v1.7.4](https://github.com/tlaplus/tlaplus/releases/tag/v1.7.4), checks the JAR's SHA-256 on every run and downloads it on first use into `$XDG_CACHE_HOME/apple-pi/tla2tools/1.7.4/` or `~/.cache/apple-pi/tla2tools/1.7.4/`. It stages each spec under its declared module name (`CommandJournal`), since TLA+ identifiers cannot contain the hyphen in `command-journal.tla`, and removes its scratch directory afterwards.

## Command journal

This model follows the runtime's **communication publication and unbound outgoing mail** path. Publication is applied by the daemon; outgoing mail is applied by a bridge. They have different meanings and different rows:

```text
publication: absent -> accepted -> applied | failed
outgoing mail:        accepted -> delivered -> applied | failed
```

A publishing receipt means the effect, saved result and outgoing mail rows committed. It does not mean a recipient received, read, understood or acted on the mail. Mail application means a durable transcript record, not successful model work.

### Source mapping

The production owner is `components/session-state/src/runtime.ts`, with mail application in `components/session-state/src/bridge.ts`. The method names below remain the mapping when unrelated source edits move line numbers.

| Model action/state | Implementation boundary |
| --- | --- |
| `Accept`, `stage` | `Runtime.command` inserts the accepted command before handling it. `repeatCommand` returns the existing row instead of executing it again. |
| `Begin`, `Write`, `Rollback` | `Runtime.communicationCommand` starts a SQLite transaction; `applyCommunication` mutates state, `preparePost`/`queueDelivery` add publication and outgoing rows, and `commands.result` stores the effect. An error rolls the transaction back before the failed stage. |
| `Commit`, `result`, `effects`, `outbox` | The same handler commits mutation, result and outgoing mail together. Volatile transaction phases expose interruptions between individual writes without making those writes independently durable. |
| `Complete` | `Runtime.communicationCommand` checks the saved result first and only finishes the applied stage if it is already present. `recoverCommunications` invokes this same handler for accepted rows at startup. |
| `Dispatch`, `handed` | `Runtime.dispatch` writes the mail to the bridge; `Runtime.hello` replays accepted/delivered unbound mail. `bridge.apply` uses `handedOver` to deduplicate queued mail. Dispatch is not itself the delivered receipt. |
| `Delivered` | `bridge.apply` reports delivered before handling a command; `Runtime.commandProgress` checks recipient/incarnation before `setCommandStage`. |
| `Record`, `transcript`, `recordings` | The bridge checks `mailRecordedIn`, hands new mail to Pi and later observes a durable transcript entry. In-memory queue insertion is not modeled as durable recording. |
| `Acknowledge` | `indexNew`/`acknowledgeMail` report applied only after transcript persistence is supported by a conversation entry. A replayed recorded id is acknowledged without another append. |
| `FailMail` | A bridge handler can report a failure before recording the mail. This is distinct from a disconnect: unbound mail remains pending across bridge loss. |
| `Observe`, `receipt`, `mailReceipt` | A same-ID retry reads the stored stage, and stage sends follow durable updates. Receipt sends can be lost; observation is optional. One observer represents an ordered receipt stream. |
| `Crash`, `Restart` | Daemon memory and uncommitted writes are lost; committed database rows and the separate Pi transcript survive. Startup repeats pending handlers; a saved result skips the effect. |
| `BridgeCrash` | Queued handover state is lost; the transcript survives. A reconnect receives pending mail again. A daemon-only crash leaves the bridge's handover state intact. |

The corresponding context contracts are `Runtime.communicationCommand`, `Runtime.repeatCommand`, `Runtime.threadPost` and `Runtime.commandProgress` in `.context/components/session-state/src/runtime.ts.md`, and `handedOver` in the bridge's context file. Existing executable implementation checks include `communication-recovery.test.ts`, `communication-reliability.test.ts`, `thread-recovery.test.ts` and `mail.test.ts` under `components/session-state/tests/`.

### Checked claims

- `NoCommandAppliedTwice`: each publication effect and each transcript record occurs at most once per stable id.
- `NoLostAppliedResult`: every applied publication has its original saved result and one committed effect; every applied mail has its transcript record. A committed effect has its saved result even before its terminal receipt.
- `AtomicPublication`: effect/result and outbox presence agree; there is no committed publication without its outgoing mail row.
- `ReceiptsMonotone`: stored stages and observed receipts never regress, including across crashes and retries; terminal applied/failed branches stay fixed.
- `ReplayIdempotent`: once a result commits, further actions preserve its value, effect count and outbox identity.
- `DurableTranscript`: a recorded mail id remains recorded across modeled restarts.

`command-journal.cfg` checks two distinct command identities, each with one representative outgoing mail row. This distinguishes same-ID retries from independent commands and explores their interleaving with one SQLite transaction writer. Crashes and replay are repeatable without a crash-count cap; state revisits make the graph finite. Result payloads are distinct immutable tokens per command. The test also makes disposable, deliberately faulty model copies: repeated effect, missing result, missing outbox and regressing receipt must all fail with a trace. These controls are **not findings against production**.

### Proof limits

This is an implementation-derived finite abstraction, not an automatically extracted model or a refinement proof. A code change can make its source mapping stale; update the model with the owning lifecycle. Passing two identities does not prove arbitrary population sizes or payload semantics.

Assumptions: SQLite transactions are atomic and committed storage is durable; Pi transcript persistence is correctly reported; same-ID retries retain their canonical input; bridge reports follow their actual ordered protocol and current-incarnation checks. The model abstracts generation numbers, transport bytes, authorization, alias resolution, payload content and multiple recipients. It allows receipt loss and crashes but makes no eventual-completion claim: a daemon or bridge can fail forever or a client can never observe a receipt. `Spec` has no fairness assumptions.

The model does not promise exactly-once arbitrary bridge effects, generic startup replay of every command kind, or durable `run_turn` results. The actual runtime fails unfinished correlated turns at startup because their waiting connections and results are transient. Filesystem work has an explicit delivered/interrupted inspection boundary; external writes, membership ordering, departures and review jobs have their own recovery contracts. Those need their own models rather than inheriting this publication guarantee. Thread posts use a durable message as a replay marker and work records use idempotent operations, rather than this model's saved communication result.

TLC checks modeled interleavings, not a power-loss experiment or JavaScript execution. Seeded actual-runtime recovery tests and physical crash tests remain separate evidence. Report a source-supported production counterexample with its trace before changing production code.
