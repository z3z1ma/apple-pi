# Lifecycle models

From a development checkout, run the command journal model with Java 21 and Node:

```bash
node scripts/run-tlc.mjs
npx vitest run tests/formal-verification.test.ts --maxWorkers=1
```

The runner and specs also ship in installed packages; the Vitest test and dev dependencies stay checkout-only. From `skills/formal-verification/` in an installed package, use `node ../../scripts/run-tlc.mjs ../../specs/command-journal.tla`.

The runner pins [TLA+ tools v1.7.4](https://github.com/tlaplus/tlaplus/releases/tag/v1.7.4), checks the JAR's SHA-256 on every invocation and downloads it on first use. The cache is `$XDG_CACHE_HOME/apple-pi/tla2tools/1.7.4/` or `~/.cache/apple-pi/tla2tools/1.7.4/`. No JAR or TLC state directory is written into the checkout. The first invocation needs network access to GitHub; a verified cached JAR works offline. A mismatching cache fails explicitly; remove that cached JAR to redownload it.

An optional spec and config can be supplied:

```bash
node scripts/run-tlc.mjs specs/command-journal.tla specs/command-journal.cfg
```

The runner supports a single module with standard TLA+ library imports. It stages the source under its declared module name (`CommandJournal`), since TLA+ identifiers cannot contain the hyphen in `command-journal.tla`. Java output, including a counterexample trace, goes to stdout/stderr and the TLC exit status is preserved. Temporary model-checking files are removed after completion or a forwarded interrupt. Capture output to retain a trace.

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
