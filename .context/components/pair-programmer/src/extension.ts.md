## file

The pair's outgoing second-opinion mail is a staged review effect, like its notes and notebook update. Failed, truncated, aborted, or stale reviews publish none. Successful requests use the main person's identity; their send receipts append to the private pair conversation without starting a model turn. Teardown aborts outstanding send waits, but mail already accepted by the runtime remains normal mail and can still receive replies.

Incoming mail is an intentional exception to the exclusion of `custom_message` entries from the pair trajectory. The pair must see a colleague's reply, including after reseeding, while preserving the distinction between mail and operator instructions. Other custom entries remain excluded from this live input path.

Historical consultant notes still render and can be acknowledged from old transcripts. Their source/disposition fields do not imply a live consultant or a second findings-delivery path.

Primary preflight marks the run active before streaming or turn_start; asynchronous callbacks use the latest hook context. The !bash append hook is installed synchronously and forwards the persisted source-entry ID, rather than waiting for pair construction or message_end.
Why: advice can settle during the pre-turn gap, and Pi persists user bash through appendMessage rather than message_end. Pair work must not delay the primary command or use a stale extension context.

The handoff compatibility hooks share the global symbol pi-amplike-handoff-in-progress and event pi-amplike:handoff-session-replaced with an external producer. While that flag is set, delivery stays blocked; the replacement event tears down old state even without session_start.
Why: a transcript replacement must not receive advice from its predecessor or race an autonomous turn. These names are an integration contract; this repository does not contain the producer.

Runtime construction is shared by concurrent hooks. An invalidated construction settles and disposes before its successor proceeds; teardown prevents stale publication.
Why: generation checks alone prevent publication but would still permit overlapping private sessions if replacement skipped the outstanding construction.

`acknowledge_pair_findings` is active only while the pair is on; each `before_agent_start` adds or removes it to match.
Why: the composed prompt teaches every active tool, so a pair tool left active while the pair was off taught the agent about a partner that did not exist.

Coupled: components/pair-programmer/src/second-opinion.ts, components/pair-programmer/src/formatting.ts, components/pair-programmer/src/seed.ts, components/pair-programmer/src/types.ts, components/system-prompt/src/toolbox.ts
Verify: components/pair-programmer/tests/second-opinion.test.ts, components/pair-programmer/tests/pair.test.mjs

## symbol:AdviseTool

Record deduplication only after the primary accepts delivery. Queued, stale or dropped callbacks leave no delivered rank; a failed send keeps confirmed notes ready for retry.
Why: recording a hold as delivery would suppress the later reconfirmed note before the operator's agent ever receives it.
Verify: components/pair-programmer/tests/pair.test.mjs, components/pair-programmer/tests/advisory-ordering.test.ts

## symbol:PairSpool

The extension owns the spool across runtime construction/replacement. Claim a contiguous prefix without removing it; a failed review retries that same prefix even when newer evidence arrives behind it.
Why: construction or review failure must not lose input or advance its committed frontier.
Verify: components/pair-programmer/tests/pair.test.mjs, components/pair-programmer/tests/advisory-ordering.test.ts

## symbol:PairRuntime

New findings require a newer successful frontier review before nonterminal delivery; findings from the successful review covering the terminal turn are already current. A correction run still feeds review input while recursive outbound advice is suppressed until new user direction.
Why: asynchronous findings can be overtaken by primary work, while terminal evidence has no later primary step to reconfirm it. Input coverage and permission to interrupt are separate.

Reset/dispose invalidates in-flight effects by epoch and resolves settlement waiters immediately. Agent reset may need to wait for the aborted prompt to unwind; drain retries reset before new work. Fold usage for compacted-away messages into lifetime accounting, resetting totals only on identity reset.
Why: late callbacks must not leak into a replacement session, waiters must not hang on an orphaned prompt, and private compaction must not erase already-incurred usage.
Verify: components/pair-programmer/tests/pair.test.mjs, components/pair-programmer/tests/native-compaction.test.ts
