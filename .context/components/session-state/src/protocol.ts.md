## file

Hello.session.interactive and incorporate are optional for older-bridge admission. Missing interactive provenance keeps unknown quit observations conservative. incorporate is an explicit root-targeted runtime mutation with actor identity; its durable result freezes successful application across replay. retire.dissolution is the root/incarnation proof for runtime-owned automatic cleanup, not a waiver for normal departure responsibility and writer-safety checks.
Coupled: components/session-state/src/organization-lifetime.ts, components/session-state/src/runtime.ts, components/session-state/src/bridge.ts
Verify: components/session-state/tests/organization-lifetime.test.ts

Hello.session.forkOffset is optional, identity-bound fork metadata from the bridge, not a requested source path. A new runtime accepts older hellos without it and withholds worker logs lacking a recorded boundary; an older runtime ignores the added field. Cost remains the existing Facts.cost field, already normalized by a current fork bridge to newly generated entries. Fresh-temp hellos and their cost convention are unchanged.
Coupled: components/session-state/src/program-fork.ts, components/session-state/src/review-read.ts
Verify: components/session-state/tests/peer-history.test.ts, components/session-state/tests/review-workers.test.ts

Versioned communication commands are runtime-owned, not bridge execution requests. Their original input and canonical operation allow exact-attempt recovery before alias/thread generation. New callers fail on older runtimes rather than silently losing access/notification semantics. Mail kind/reference are optional because retained legacy outbox rows cannot infer them from titles; new publication supplies both.

Communication effects remain on the existing command journal. Receipt.result is still the original correlated turn owner's ephemeral result; retry receipt observation does not transfer its ownership.
Coupled: components/session-state/src/communication-types.ts, components/session-state/src/runtime.ts, components/session-state/src/bridge.ts
Verify: components/session-state/tests/communication-recovery.test.ts, components/session-state/tests/peer-turns.test.ts

## symbol:CommandRequest

Client-selected command IDs make retries idempotent. A supplied generation pins the request to that incarnation; omission targets the current one. Receipts report acceptance/delivery/application, not a generic done or proof of observed effects.
Why: retrying must not duplicate work, and an old incarnation's command must not reach a replacement session. Effects remain observable events rather than inferred success from acceptance.
Verify: components/session-state/tests/commands.test.ts

## symbol:Command

A follow-up remains withdrawable only while the session holds it. Mail differs from ordinary commands: accepted mail waits for a stopped recipient to reopen, and application means its transcript recorded it. Startup work is assigned before the new process begins; existing identities retain their recorded role/specialization and mind instead of being rehired through a start request.
Why: queuing is not consumption, accepted mail is not immediate delivery, and reopening a person must not silently change its identity or start its first turn without the assigned goal.

Agent transfer stays within its organization and moves the person's reports; operator organization_move can move a branch across organizations or make it independent. Ledger task movement changes a bundle path, not assignments. set_preference's sessionId identifies a view client rather than necessarily a person.
Why: these runtime-owned operations have different authority and ownership from a bridge executing a session command; treating every request as an ordinary person-targeted command loses those boundaries.
Coupled: components/session-state/src/runtime.ts, components/session-state/src/bridge.ts, components/session-state/src/work.ts
Verify: components/session-state/tests/commands.test.ts, components/session-state/tests/mail.test.ts, components/session-state/tests/organization-move.test.ts

## symbol:Facts

Each changed facts field replaces its whole value, including nested values. queue.pending can include extension messages; steers/followUps count the typed input queues.
Why: merging nested snapshots or interpreting every pending message as user input would retain stale state or misreport what the operator queued.
Coupled: components/session-state/src/bridge.ts, components/session-state/src/runtime.ts

## symbol:Subscribe

A subscription replaces that connection's earlier session list; an empty list ends it, and the acknowledgment precedes relayed data. ReplyDelta sequence numbers may skip when deltas are coalesced without losing their text. ReplyEnd names the stored transcript replacement when one exists and ends earlier unfinished streams too.
Why: independent view owners must aggregate their lists rather than overwrite each other; a sequence gap alone is not lost text, and stored history replaces transient text rather than duplicating it.
Coupled: components/session-state/src/reply-relay.hot.ts
Verify: components/session-state/tests/streaming.test.ts

## symbol:IndexRow

Index rows hold addresses/previews, while transcript JSONL retains the actual entry. part is empty for a whole message or the call ID for a nested tool call. Recall drill-down acting as a person still needs permission to read another person's task span.
Why: the index is not a second transcript or a way around source access checks.
Coupled: components/session-state/src/transcript-read.hot.ts
Verify: components/session-state/tests/transcript-index.test.ts, components/session-state/tests/peer-history.test.ts
