# Time-traveling stream rules versus tool refusals

Research date: 2026-11-07. Decision owner: the operator. Inquiry owner: Jean-Paul Shammas, task `work-8dd5a8f2-6ea8-446a-9e0b-7484eb3b62ee`.

## Recommendation

Keep apple-pi's pre-execution rule refusals. **Time Traveling Stream Rules (TTSR) have merit as optional early output coaching, not as their replacement.** Its distinctive benefit is interrupting a long wrong draft before the model finishes it. For a short forbidden tool call, our existing path already prevents that call and gives the model a named correction on its next step. Rewinding adds no rollback of side effects and does not remove that next model request.

Borrow the principle of specific, just-in-time guidance. Consider stream interruption only if long wrong output is the actual problem. Improving a demonstrated unclear refusal is a smaller intervention than importing a second rule lifecycle. This report recommends discussion, not implementation or a new evaluation project.

## Evidence and limits

**Seen:** GitHub's commit API identified upstream HEAD as `can1357/oh-my-pi@abc8f6eef3404f7cd91b3d52f150c97466c26ff6`, committed 2026-11-07 16:32:40 UTC. I downloaded that exact archive and read the decisive coordinator, matching, tool-adapter, persistence, replay and test source. All upstream links below use this pin.

I also read apple-pi's rules implementation, refusal/batch tests and context contracts at local HEAD `22cab5f986601771bab8f41a5656f53f0d83e573`; the relevant files had no working-tree diff. I read installed Pi **1.4.0** extension docs, declarations and agent-loop implementation. That dependency evidence describes the installed version, not an independently pinned Pi Git checkout.

**Told, then checked where decisive:** a research intern mapped upstream paths; an explore intern mapped local paths. Shinobu Kudo formed an independent assessment before our synthesis. His challenge corrected two tempting overclaims: discard does not erase all durable evidence, and a tail rewind does not necessarily destroy the entire prompt cache. I checked both against source.

**Not measured:** model compliance, learning, false-positive rates, cancellation responsiveness, billing of aborted output, net latency, token use or cache hits. No software test suites were executed for this inquiry; test descriptions below are inspected assertions. Report checks passed for whitespace, 10 local citation paths, and nine pinned upstream paths/line ranges. No private-session audits, live-user experiments, implementation, runtime changes or session reloads were performed.

## What upstream actually does

### 1. It has several mechanisms, not one universal rewind

The [coordinator][U1] observes assistant `text_delta`, `thinking_delta`, `toolcall_delta`, finalized tool arguments and final nonempty text/thinking blocks. Default scope is text and tool arguments, **not thinking**. It isolates stream buffers and resets them between assistant responses and provider partial-response restarts.

Regex rules run during generation. Tools may supply per-file `matcherEntries` or a combined `matcherDigest` (source text for matching, not a cryptographic hash); otherwise matching uses raw argument deltas, with a final argument snapshot when deltas are absent. These adapters make payload matching more useful than a regex over escaped JSON, but do not make incomplete arguments equivalent to a completed execution plan.

Abstract syntax tree (AST) rules match code structure rather than raw text. They run separately in an **awaited pre-tool hook**, against finalized validated arguments. They need a usable source digest and file extension. Upstream's [lifecycle contract][U2] explicitly says this source is generally the **new payload**, not the prospective whole file: replacement text or added lines for edits, full content for creates/writes. Our whole-file preview therefore has different semantics.

Natural-language `question` rules are different again: they use a judge after completed outputs and deliver warnings, not stream interrupts. The code groups eligible questions into one judge request per output; a message can yield separate text, thinking and per-tool/per-file outputs. These checks have their own model cost and cannot serve as pre-side-effect gates. [U1, U2]

### 2. An interrupt means abort, guidance and another request

When any matched rule permits interruption, `#handleMatches`:

1. Queues matching rule guidance and matched excerpts.
2. Calls `agent.abort()` immediately, then emits a TTSR event asynchronously.
3. Schedules post-prompt work with a 50 ms delay.
4. Checks retry token, prompt generation, abort state and target assistant identity.
5. In default `contextMode: discard`, replaces active agent messages with the prefix before the targeted assistant message. `keep` leaves that tail in active state.
6. Appends a hidden `ttsr-injection` message, persists its content and rule-name suppression records, and schedules continuation. [U3]

The timer alone is not the resume protocol; session ownership, guards and a resume gate matter. Normal interrupt correction consumes the current/aborted completion **plus a subsequent model request**, not a magic revision of the existing provider response. Matching itself is deterministic for regex/AST and does not call a model; judged rules do.

In an ordinary tool batch, a stream abort prevents those still-undispatched calls; upstream's loop emits skipped/aborted result placeholders rather than executing their bodies. An AST interruption blocks the checked call before dispatch and starts the retry path. **Neither reverses earlier work.** Provider/bridged execution can have different boundaries, so “nothing in the session has executed yet” would be too strong. [U1, U4]

Upstream itself treats bridged inner calls—tools invoked through another tool or provider bridge rather than the ordinary assistant-call loop—differently: `beforeBridgedToolCall` can return a blocking reason plus reminder **without rewinding**. Non-interrupting tool matches let the tool run and add passive guidance after its result. Non-interrupting prose queues a follow-up. Some host/prelude calls are outside the bridged-AgentTool path. [U1, U2]

### 3. Its defaults are teaching defaults

Defaults include `enabled: true`, `interruptMode: always`, `contextMode: discard`, `repeatMode: once`; optional `after-gap` counts completed turns, with default gap 10. Once injected, a rule normally stops triggering. Persisted suppression stores names, not original ages; restored ages start at zero. Invalid regex conditions are warned about and skipped; AST matching failures count as no match. These are materially different from repeatedly enforcing a configured rule and refusing when its evaluator fails. [U5]

The repeat gap is not a maximum number of retries. Several rules or repeated rearming can still cause correction cycles. Equally, suppressing a noisy advisory rule can be sensible; it simply should not suppress a hard tool gate.

### 4. Discard is not deletion of all audit history

The coordinator changes active model state and writes hidden reminder/suppression entries. Upstream persists assistant messages and separately reconstructs provider versus display context. Its [session-context reconstruction][U6] removes orphaned tool calls, handles protected thinking when reshaping turns, and drops aborted/error turns and their paired results from model replay while allowing transcript representation. Consequently, `keep` for the active retry is not a promise that every later reload replays the same aborted tail.

The UI has a dedicated TTSR notice and rewind presentation. `ttsr_triggered` also occurs on some non-interrupting paths, so counting that event alone would not count rewinds. The audit problem is keeping attempted output, actual tool effects, guidance and provider replay coherent, not an established claim that upstream silently erases evidence. [U1, U2, U6]

## Our actual refusal path

The [rules extension](../../components/repo-rules/src/index.ts), `installRepoRules`, hooks **`tool_call`**, not the assistant stream. It recovers the finalized assistant batch from the current root/fork projection; nested calls receive a singleton batch.

The [engine](../../components/repo-rules/src/engine.ts), `checkCall`, gathers:

- Top-level `edit`/`write` checks: reconstruct proposed content using Pi's own edit implementation without writing it, then apply comment policy, GritQL over the whole proposed file and edit scripts.
- Action patterns over the bash command.
- Call scripts over tool/input, resolved path facts, literal shell facts, nesting and the assistant batch.

Applicable user/project refusals are combined into one named reason. Broken configured evaluators refuse and direct repair. Rules-directory changes have a separate sample-validation repair path. A preview that cannot produce a valid edit is left for the underlying tool to reject. Nested calls still get actions/call scripts but **skip edit checks**. Shell path facts are heuristic, and arbitrary shell mutations are not whole-file GritQL checks. These are workflow guards, **not a security sandbox**. [Local contract](../repo-rules.md)

The extension returns `{ block: true, reason }`, with no `terminate`. Installed Pi's `prepareToolCall` validates/prepares arguments, awaits the hook and produces an `isError` tool result for a refusal. In parallel mode, `executeToolCallsParallel` preflights calls before launching the prepared tools, but **one refusal only blocks its own call**. Siblings can execute. Sequential mode is also supported and has a different ordering boundary. The core retains results and ordinarily requests the next model step; it does not rewrite the attempted batch or guarantee that the model's correction succeeds.

The inspected [host test](../../components/repo-rules/tests/batch-host.test.ts) explicitly expects a write to apply while a dependent sibling read is refused. This is not atomic batch cancellation. A codemode script can also finish an inner call before a later inner call is refused.

Recording is explicit but not omniscient:

- [Firings](../../components/repo-rules/src/firings.ts) append rule/root/time records outside the repo.
- [Evidence discovery](../../components/repo-rules/src/evidence.ts) recognizes error results whose text begins `Refused`, and provides source-entry references.
- [Replay](../../components/repo-rules/src/replay.ts) tests recorded top-level calls/batches without executing them or recording new firings. Historical edits lack the old whole file, so added text is checked; edit-script `content` is null for edits. Nested calls are not replayed as standalone assistant calls. A replay is not complete re-execution of the original live check.

## Consequences for experience, cost and implementation

| Question | Assessment |
| --- | --- |
| Does TTSR prevent more tool side effects? | It can detect earlier, but our configured gate already blocks the refused invocation. Early detection does not undo siblings, prior steps, nested calls or a tool that partially failed after execution. |
| Can it make correction feel better? | Possibly: less wrong prose reaches the user, and a focused reminder replaces a long draft in active context. Conversely, interruption can feel like flicker or an unexplained restart. Our error result is more visibly literal about what failed and what succeeded. Neither UX advantage is measured. |
| Does it teach better? | Both provide just-in-time guidance. A discarded bad draft may reduce anchoring or remove a useful concrete example. This is in-context correction, not weight learning. Evidence does not choose between those explanations. |
| Does it save tokens? | Both already keep rule bodies out of ordinary prompt text. Early cancellation may avoid an ungenerated tail, while retries regenerate useful discarded material and add guidance. A short blocked call offers little tail to save. No net saving is established. |
| What happens to latency? | Streaming regex adds per-update work; upstream throttles larger multiline rescans and finalizes checks at block end. Our finalized checks have their own GritQL child-process/script cost. Cancellation, model restart and any judge requests add other costs. Source alone cannot price the total. |
| What happens to caching? | Ordinary refusal appends a tool-result suffix. A tail rewind may preserve the identical prefix before the cut; it does **not necessarily invalidate the whole cache**. Changed suffixes, regenerated output, wire encoding and provider cache policy determine actual effects. No cache-hit claim is supported. |
| How much would adoption cost? | A small detector is not the whole system. Upstream owns stream callbacks, cancellation, retry generations, provider-safe replay, persistence, suppression, UI and bridges. That integration is the expensive part. |

Our [context contract](../context.md) and [empty context-hook allowlist](../../tests/context-hooks.test.ts) favor append-only requests; the [section test](../../tests/system-prompt-sections.test.ts) asserts an earlier request prefix survives later changes. A per-request history-rebuilding filter would conflict with that design. A deliberate tail cut is a narrower operation, not proof of total prefix-cache loss, but still needs an explicit owner.

Installed Pi 1.4.0 exposes normalized `message_update` and provider stream observation, plus `ctx.abort()`. Stream handlers are notification-only; returning a replacement does not rewrite the stream. Handler failures are not a fail-closed stream-policy decision. `message_end` can replace a finalized message; `tool_call` is the explicit gate. Ordinary extension context exposes a **read-only** session manager, while tree navigation is command-only. It does not expose upstream's session-owned discard/inject/resume operation.

An extension can compose some observation, abort and message-delivery primitives, but a faithful rewind would require lifecycle/API design, not simply returning `{ block: true }` from a stream hook. Session abort intentionally stops automatic post-run continuation in the installed core. A home-grown timer or private agent mutation would have to confront cancellation, new prompts, mail/steering, forks, reloads, signed thinking and call/result pairing. I recommend neither as an incidental rules enhancement.

## Concrete examples

These are source-derived scenarios, not experiments:

1. **Forbidden shell command:** the model proposes `git push`. Our action rule refuses before bash executes and supplies the correction. TTSR can notice the command while generating arguments, but still needs another request. The incremental benefit is avoiding remaining generation, not avoiding an execution our gate would have allowed.
2. **Write plus dependent read:** our batch script can refuse the read while allowing the write. Erasing that completed assistant batch would hide an applied write. Regeneration could repeat a non-idempotent sibling operation. Preserve actual outcomes; this is not a safe “undo.”
3. **Codemode sends mail, then attempts a forbidden shell call:** the mail may already exist when the nested shell call is refused. Rewinding the parent script does not unsend it. Retrying the parent can send it twice. Upstream's local bridged-call refusal is closer to the correct boundary here.
4. **Long prose takes the wrong direction:** an early reliable phrase identifies an unwanted format near the start of a long answer. A tool-only gate cannot intercept that prose; TTSR can abort and coach. This is its clearest distinct opportunity, with quotation/exception false positives still to resolve.
5. **An edit's legality depends on unchanged surrounding structure:** our proposed-file check can see it; upstream's added-payload AST snapshot may not. Replacing GritQL with TTSR's AST path would change the rule's meaning even though both use syntax matching.
6. **The model repeats the violation:** our matching gate refuses again. Default TTSR `once` no longer triggers that rule after injection. Useful advisory cooldown is not equivalent enforcement. Neither mechanism guarantees convergence.

## Options for discussion

1. **Retain the current mechanism — recommended now.** Keep explicit refusals and factual outcomes. If a particular reason is unclear, improve that reason based on the concrete failure. Lowest added complexity; no prose-stream interception.
2. **Explore optional early-output coaching, separately authorized.** A harness capability for long unexecuted drafts, keeping deterministic tool gates intact. It could borrow scoped triggers and focused reminders, but needs an honest audit/replay/cancellation contract. Worth considering only if long wrong generation is a meaningful pain.
3. **Import generalized discard-and-retry for tool refusals — not recommended.** It changes history and lifecycle ownership to solve a problem largely handled by existing tool results, with partial-batch/nested side-effect risks. If the desired feature is all-or-none pre-dispatch batch rejection, state that as a separate requirement; it is not rollback and does not require prose streaming.

The next useful question for the operator is **which pain he wants to remove: long wrong drafts, repeated unclear refusals, or incorrect side effects?** Those imply different changes. If he later authorizes evidence gathering, the discriminating comparison is a long reliably detectable wrong draft versus a short blocked call, while requiring preservation of every successful sibling/nested effect. Measure correct completion and end-to-end latency/cost including retries; a smaller active transcript or cleaner screenshot alone would not establish value. No such evaluation is authorized or started here.

## Primary source index

All upstream references are pinned to `abc8f6eef3404f7cd91b3d52f150c97466c26ff6`.

- [U1 — Coordinator: streamed/finalized/bridged checks and reminder paths][U1].
- [U2 — First-party lifecycle description, including AST payload semantics and judged rules][U2].
- [U3 — Abort, guarded active-state discard, durable injection and continuation][U3].
- [U4 — Aborted ordinary tool calls receive skipped-result placeholders][U4].
- [U5 — Defaults; repeat suppression; evaluator failures and restore][U5].
- [U6 — Provider/display reconstruction, dangling calls and protected reasoning][U6].
- [U7 — Per-file and combined tool matcher adapters][U7].
- [U8 — Durable rule-name injection entries][U8].
- [U9 — Buffer, deferred delivery and repeat-gap source tests][U9].

Installed Pi evidence: `@earendil-works/pi-coding-agent@1.4.0`, `docs/extensions.md`; `dist/core/extensions/types.d.ts` (`ExtensionContext`, `ExtensionCommandContext`, `ProviderStreamEvent`, `MessageUpdateEvent`); `dist/core/extensions/runner.js` (`emit`); `dist/core/agent-session.js` (`_beforeToolCall`, `_startRun`, `abort`); `@earendil-works/pi-agent-core/dist/agent-loop.js` (`prepareToolCall`, `executeToolCallsParallel`, `shouldTerminateToolBatch`, main continuation loop).

Independent challenge: Shinobu's report in task `work-d2369cb5-e620-47d2-b345-8b2b0e279c3f`, exchanged in thread `t-bf7448a1-a97a-4539-9351-679798429270`. Agreement is not additional experimental evidence; Jean-Paul owns this synthesis and recommendation.

[U1]: https://github.com/can1357/oh-my-pi/blob/abc8f6eef3404f7cd91b3d52f150c97466c26ff6/packages/coding-agent/src/session/ttsr-coordinator.ts#L139-L335
[U2]: https://github.com/can1357/oh-my-pi/blob/abc8f6eef3404f7cd91b3d52f150c97466c26ff6/docs/ttsr-injection-lifecycle.md
[U3]: https://github.com/can1357/oh-my-pi/blob/abc8f6eef3404f7cd91b3d52f150c97466c26ff6/packages/coding-agent/src/session/ttsr-coordinator.ts#L678-L757
[U4]: https://github.com/can1357/oh-my-pi/blob/abc8f6eef3404f7cd91b3d52f150c97466c26ff6/packages/agent/src/agent-loop.ts#L1594-L1638
[U5]: https://github.com/can1357/oh-my-pi/blob/abc8f6eef3404f7cd91b3d52f150c97466c26ff6/packages/coding-agent/src/export/ttsr.ts
[U6]: https://github.com/can1357/oh-my-pi/blob/abc8f6eef3404f7cd91b3d52f150c97466c26ff6/packages/coding-agent/src/session/session-context.ts#L695-L786
[U7]: https://github.com/can1357/oh-my-pi/blob/abc8f6eef3404f7cd91b3d52f150c97466c26ff6/packages/coding-agent/src/session/ttsr-outputs.ts#L70-L127
[U8]: https://github.com/can1357/oh-my-pi/blob/abc8f6eef3404f7cd91b3d52f150c97466c26ff6/packages/coding-agent/src/session/session-manager.ts#L3823-L3841
[U9]: https://github.com/can1357/oh-my-pi/blob/abc8f6eef3404f7cd91b3d52f150c97466c26ff6/packages/coding-agent/test/ttsr-coordinator-buffer.test.ts
