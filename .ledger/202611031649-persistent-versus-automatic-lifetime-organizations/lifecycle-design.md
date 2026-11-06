# Organization lifetime: source trace and design model

This is a pre-implementation design model, not a proof of the runtime. It was refined to the operator's settled decisions in task-thread message 13518. Runtime/backend implementation and focused verification landed in source cut 4a7ba521; integrated app review and activation remain. The source mapping below names the implemented seams without claiming refinement proof or live activation.

## Required property

Automatic dissolution can commit a person's permanent departure only while the original root's close request is still current, the organization remains unincorporated, the person still belongs to that organization, and that person is idle without unfinished work, reports or owned program resources. Reopening or incorporating stops further automatic departures. Permanent departures already committed stay permanent. Removal of files follows departure and writer death proof; removal of private records follows file cleanup. Crash/restart preserves pending cleanup, rather than inventing a close request.

## Pre-implementation source trace

Read in the checkout on 2026-11-06 at 02db92c1, before the lifetime implementation. These ranges describe that cut, not shifted current line numbers:

- `components/session-state/src/bridge.ts:687-692`: a delivered `close` command acknowledges, aborts the current run and requests host shutdown. Automatic cleanup therefore needs an additional idle guard; ordinary close is not itself a wait-until-idle operation.
- `bridge.ts:708-753`: session start replaces the link; reload reconnects without a permanent closing signal.
- `bridge.ts:754-772`: shutdown sends the host's reason verbatim except reload, which closes the link without a shutdown reason.
- `components/session-state/src/runtime.ts:518-522`: a bridge shutdown ends its incarnation and marks the session idle.
- `runtime.ts:589-624`: the same process reconnect retains its open incarnation; a different process supersedes the old incarnation.
- `runtime.ts:3518-3561`: durable incarnation endings distinguish bridge reasons, `superseded` and `process gone`. Unknown process checks leave the writer unproven, not dead.
- `runtime.ts:369-389`: daemon shutdown kills runtime-owned headless children and destroys connections. It does not call the ordinary incarnation-ending path.
- `runtime.ts:1041-1093`: departure refuses self/duplicate departure, a nonoperator root departure, temporary peers, unfinished assigned work, unfinished owned reviews, direct reports (including pending departures), program scopes/peers and a no-handoff first launch without an observed process identity.
- `runtime.ts:1096-1225`: retirement optionally requests a handoff, then rechecks responsibilities and identity before atomically recording `person_departed`, the retired snapshot, notices and a close delivery. No-handoff skips the model turn, not the guards.
- `runtime.ts:1494-1518`: restart resumes committed cleanup and fails interrupted precommit handoffs; it does not run a second paid handoff.
- `runtime.ts:2435-2558`: departure cleanup proves writers stopped, validates ownership after awaits, removes checked files and then removes private records. Cleanup can resume after either store boundary.
- `components/session-state/src/departures.ts`: the permanent marker survives row removal; header identity and observation-watermark checks protect cleanup. Shared task/mail/accounting history survives private cleanup.
- `components/session-state/src/program-peers.ts`: program disposal is a different lifecycle and emits lifetime temporary-identity facts. Lasting people must use permanent departure, not generic peer disposal.
- `apps/agent-workplace/src/backend/lifecycle.ts:129-146`: Workplace endSession sends the ordinary close command, with busy-turn confirmation.

Installed host source, not a fresh interactive execution:

- `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:638-639`: shutdown reasons are `quit | reload | new | resume | fork`.
- `dist/core/agent-session-runtime.js:102-112,296-302`: switching forwards its reason; disposal always emits `quit`.
- `dist/modes/interactive/interactive-mode.js:3444-3478,3538-3553`: ordinary quit and SIGTERM/SIGHUP use disposal. A terminal error can instead emergency-exit without normal teardown.
- `dist/modes/rpc/rpc-mode.js:579-600,639-640`: SIGTERM and stdin EOF also dispose. Thus a raw RPC `quit` cannot distinguish explicit closing from a daemon restart killing or orphaning its headless child.

Settled policy: explicit close commands plus observed interactive quit/window close count; reload/session replacement, process loss, supersession and daemon restart do not. A raw headless quit without recorded explicit closing intent stays conservative. Reopen/incorporate stops future departures, while already committed departures stay permanent. Splits retain the current source incorporation; merges adopt the target status. Unassigned backlog stays in the task store and does not block cleanup.

## Model mapping

Files: [specification](organization-lifecycle.tla), [configuration](organization-lifecycle.cfg).

The instance has five identities: root 1, manager 2, worker 3, incorporated foreign root 4, and program-temporary peer 5 owned beneath manager 2. A three-level lasting tree distinguishes leaf-first deletion from merely deleting immediate reports. The separate incorporated root distinguishes moving out from cancellation. The peer distinguishes program disposal from lasting departure.

| Action/state | Runtime owner or proposed seam |
| --- | --- |
| `CloseRoot`, durable `closing` and `epoch` | `Runtime.observeOrganizationClose`, sessions.closing_generation bound to current incarnation rather than inferred from missing liveness |
| `LoseRoot` | Existing process-loss observation, without creating closing intent |
| `ReopenRoot`, `Incorporate` | `Runtime.admitOrganization`/`startSession` and `finishIncorporation`, canceling pending dissolution |
| `MoveLeaf`, `SplitLeaf` | `Runtime.organizationMove`, source incorporation retained on split and membership rechecked at departure commit |
| `BeginTurn`, `Settle`, `FinishWork`, `AcquireWork` | Existing idle state and durable assignments/reviews; a turn or new work may start after selection |
| `CloseProgram`, `DisposePeer` | Existing program ownership/disposal; temporary peer never takes the lasting-departure action |
| `Select`, volatile `selected`/`selectedEpoch` | `Runtime.dissolveOrganizations`, selection before its command-socket await |
| `Commit`, durable `departed` | `Runtime.departureCandidate`/`retireSession`, with `requireDissolution` checking current organization/incarnation/idle guards |
| `Exit`, `writers` | Abstract truthful writer process-death observation |
| `Unlink`, durable `files` | Existing checked file cleanup after permanent commit and writer proof |
| `RemoveRecords`, durable `live` | Existing private-record cleanup after files, leaving permanent history |
| `Crash`, `Restart`, durable state retained | Runtime interruption/recovery; volatile selection is lost |

`Ready` uses current idle/work/report/program state, not the state at selection. `Authorized` uses current root intent, incorporation, membership and epoch. Root departure waits for report rows to disappear, including rows already marked departed but still awaiting file cleanup. Reopening does not undo a committed departure and does not block already-authorized file cleanup for that departed child.

## Checks so far

`tlc_check` exhaustive, two workers, 90-second limit; TLA+ 1.7.4 / TLC 2.19, Java 21.0.4:

- Final normal configuration, including turns starting after selection and retained incorporation on split: **PASS**, 5,901,719 generated states, 715,752 distinct, zero queued, depth 34. No action was reported never taken. [Retained verdict](lifecycle-pass.txt).
- Final `constants: {UnsafeCommit: "TRUE"}`: **VIOLATION**, `NoInvalidDeparture`, 19,395 generated / 4,842 distinct / 2,977 queued, depth 7. [Retained trace](lifecycle-control.txt).
- Before split refinement, the model including new turns passed 2,015,480 generated / 251,556 distinct / depth 31; the final run supersedes those narrower counts.
- Earlier model without the separate new-turn action passed 466,742 generated / 79,586 distinct; its control failed at depth 7. The final run supersedes those narrower counts.
- Control trace: close root (epoch 1), settle worker 3, finish its work, select worker 3 under epoch 1, reopen root (epoch 2, closing false), commit the stale selection. The missing authority recheck departs worker 3 after cancellation.

The control is deliberately faulty design, not an implementation defect. Model construction first needed an identifier-compatible module header and explicit Boolean parentheses; initial parser failures were setup errors and provide no product evidence.

## Bounds and assumptions

- Safety only. No fairness or eventual cleanup promise is checked. A person holding work forever can keep its branch forever.
- Epochs range from zero through three, enough for close, reopen and another close; crashes/restarts and work arrivals repeat within the finite state graph.
- Worker 3 can move to the foreign organization and back, or split into an independent root retaining its current source incorporation. Root-wide merges, stale bridge metadata and migration are not modeled; ordinary runtime tests cover those implemented boundaries.
- Idle and unfinished work are independent. Owned reviews/held assignments collapse into one work bit. Unassigned backlog is intentionally outside it because the operator chose to retain tasks without retaining the organization.
- Writer death is assumed truthful. PID reuse, rejected late producers, transcript header parsing, filesystem errors and SQL details remain covered only by their existing implementation guards/tests and the separate departure model; this model does not prove them.
- Departure commit and record removal are separate atomic database steps. File unlink is a separate durable step. A crash between unlink and record cleanup remains recoverable in the model.
- Incorporation and closing are durable, while candidate selection is volatile. Migration, flag parsing, mixed bridge versions and UI/API forwarding need ordinary runtime tests.
- The design model encodes the settled visible semantics. Its transition-to-owner map is not an automatic extraction or refinement proof of the implementation.

## Next steps and owners

Niamh committed the runtime/bridge/API source cut as 4a7ba521 with focused and regression evidence in implementation-evidence.md. Tadhg owns the Workplace menu, final bundled app build, integrated review and shared runtime activation. This model neither authorizes a restart nor establishes that the live migration ran. The live migration must still verify all three named existing roots as incorporated.

Reproduce the normal check with `tlc_check({spec: ".ledger/202611031649-persistent-versus-automatic-lifetime-organizations/organization-lifecycle.tla", workers: 2, timeLimit: 90})`. Repeat with `constants: {UnsafeCommit: "TRUE"}` for the deliberately faulty control. The retained text files are tool verdicts for these configurations, not ordinary runtime test output. Refresh both and their counts above if the model or configuration changes.
