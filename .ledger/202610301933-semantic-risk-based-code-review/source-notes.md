# Sources for semantic, risk-based code review

## What these sources establish

This is source inspection, not an evaluation of review quality. The three repositories were shallow-cloned into `/tmp/tadhg-review-design/`; none was installed or run. Their benchmarks were not reproduced. The implementation proposal is original design, not a recommendation to import any of their engines.

| Project | Inspected revision | Declared license | Relevant contribution |
| --- | --- | --- | --- |
| [Open Code Review](https://github.com/alibaba/open-code-review) | `216dcf513593055a70165f793e96b52589d71b1b` | Apache-2.0 | File grouping, selection accounting and resolved input identity |
| [PR-AF](https://github.com/Agent-Field/pr-af) | `421fbd23bf1c5a2c3916d7046c97b5273958e1f4` | Apache-2.0 | Risk-specific investigation dimensions and finding challenge |
| [roboRev](https://github.com/kenn-io/roborev) | `98d011f560de01a9d2b27eeeeb51bd11fd32c5ff` | MIT | Persistent local queue, retained results, exact checkout paths and operator controls |

Licenses above describe these projects, not a transitive dependency audit. No source or prompt text is being copied. A later decision to import code requires a separate dependency/license check and provenance entry.

## Open Code Review groups files, not semantic code regions

Root-checked owners at the pinned revision:

- [`internal/agent/selection.go`](https://github.com/alibaba/open-code-review/blob/216dcf513593055a70165f793e96b52589d71b1b/internal/agent/selection.go): `selectFiles` is a deterministic pre-dispatch selection pass shared by preview and execution. It distinguishes selection from subsequent budget exhaustion or execution failure. Binary, secret-path, user-rule, extension and token-size decisions can exclude files. Deleted files remain in the change context but are not dispatched as review units.
- [`internal/agent/grouping.go`](https://github.com/alibaba/open-code-review/blob/216dcf513593055a70165f793e96b52589d71b1b/internal/agent/grouping.go): `buildFileList` supplies indexed file metadata to the grouping model. `parseGroupingResponse` removes duplicate/out-of-range indices, gives omitted files singleton groups, and applies group size/token limits. The unit remains whole file diffs.
- [`internal/agent/agent.go`](https://github.com/alibaba/open-code-review/blob/216dcf513593055a70165f793e96b52589d71b1b/internal/agent/agent.go): `formatDiffEntry` supplies status, path and addition/deletion counts. This grouping input is not the changed implementation. Review dispatch and later filtering are separate stages.
- [`internal/agent/identity.go`](https://github.com/alibaba/open-code-review/blob/216dcf513593055a70165f793e96b52589d71b1b/internal/agent/identity.go): `ResolveIdentity` resolves moving commit endpoints before admission; `SealedInput` passes the resolved endpoints to execution. Identity hashes the final selected source artifact and rule configuration. This is stronger than a branch label, but is not evidence that every surrounding context read is an immutable snapshot.

**Borrow:** deterministic accounting, omission detection, preflight identity, and grouping related changes before dispatch.

**Change for this proposal:** give the planner code and contracts, permit several regions of one file to belong to different behavioral chunks, and retain deletion/binary/generated-file obligations explicitly. A selection filter cannot make omitted work count as reviewed. Hard-coded group sizes and token thresholds are not evidence-based defaults for this harness.

## PR-AF offers useful lenses, with limits in the inspected execution path

The maintained default Git installation selects the Go package. This inspection concerns that path, not a claim about every Python path or historical version.

Root-checked owners:

- [`go/internal/diffengine/cluster.go`](https://github.com/Agent-Field/pr-af/blob/421fbd23bf1c5a2c3916d7046c97b5273958e1f4/go/internal/diffengine/cluster.go): `ClusterChanges` groups by directory. These are structural hints, not semantic boundaries.
- [`go/internal/orch/phases.go`](https://github.com/Agent-Field/pr-af/blob/421fbd23bf1c5a2c3916d7046c97b5273958e1f4/go/internal/orch/phases.go): semantic, mechanical and systemic meta-selectors produce investigation dimensions; review dispatch filters patches to each dimension's target files. Reviewers can request bounded sub-reviews. Schema failure has an explicit failure path rather than always becoming an empty findings list.
- The same file assigns `o.effectiveDepth = o.escalateDepth(reviewDepth)`, but the immediately following dimension cap selects `config.DepthProfiles[reviewDepth]`, the original value. Therefore that assignment alone does not establish adaptive dimension count in this path.
- `dedupCrossMeta` in the same file deduplicates by sorted target-file set, retaining the higher-priority dimension. Two different questions on the same files can therefore collapse. This proposal treats a lens/question as part of review identity, not just its file set.
- [`go/internal/orch/orchestrator.go`](https://github.com/Agent-Field/pr-af/blob/421fbd23bf1c5a2c3916d7046c97b5273958e1f4/go/internal/orch/orchestrator.go): `escalateDepth` counts blast radius, intent gaps, risk surfaces, additions and low meta-selector confidence against fixed thresholds. This is a heuristic, not calibrated risk estimation.
- [`go/internal/scoring/scoring.go`](https://github.com/Agent-Field/pr-af/blob/421fbd23bf1c5a2c3916d7046c97b5273958e1f4/go/internal/scoring/scoring.go): `ScoreFindings` combines severity/confidence and adversary/global multipliers, filters by confidence, and associates adversary results by finding title. The source proves this mechanism, not the calibration of its scores.

**Borrow:** reviewers should answer specific questions derived from the actual change, rather than each reciting a general checklist. Challenge a finding against counterevidence.

**Change:** keep distinct questions on shared files; make the selected depth govern actual required passes; retain uncertain findings rather than hide them below a model-confidence cutoff. No numeric risk score, confidence threshold, recursive reviewer spawning or vendor budget constants are adopted.

## roboRev supplies the strongest queue precedent, not a turnkey apple-pi owner

Root-checked owners:

- [`README.md`](https://github.com/kenn-io/roborev/blob/98d011f560de01a9d2b27eeeeb51bd11fd32c5ff/README.md) describes local background reviews, TUI/browser queues, panels, finding verification, comments, cancellation and reruns. It also describes fix/refine loops; these are outside the proposed initial scope.
- [`internal/storage/jobs.go`](https://github.com/kenn-io/roborev/blob/98d011f560de01a9d2b27eeeeb51bd11fd32c5ff/internal/storage/jobs.go): `EnqueueOpts` records repository, commit/range, branch, model/provider, worktree and panel metadata. Dirty diff content is captured at enqueue. `EnqueueJob` commits the row and payload together, before a worker can claim it. `ClaimJobContext` owns the atomic queued-to-running transition.
- [`internal/daemon/worker.go`](https://github.com/kenn-io/roborev/blob/98d011f560de01a9d2b27eeeeb51bd11fd32c5ff/internal/daemon/worker.go): `prepareJobCheckout` distinguishes prompt, configuration and agent checkouts. Eligible committed reviews can use a daemon-owned exact checkout. The non-committed/dirty branch returns the effective working checkout in the inspected function. Persisting a dirty patch does not, by itself, freeze all later source reads.

**Borrow:** enqueue before dispatch, retain attempts/results, separate queue state from the screen that shows it, and keep exact source identity visible.

**Change:** reuse apple-pi's existing daemon and root-session lifecycle. Do not import another daemon, provider adapter layer, task database or auto-fix loop. Dirty-target source reads must also use captured content.

## Existing apple-pi capabilities and the missing guarantees

Local baseline: `9160a5183eb0f979f1b5c11d998e64dc10855ed4`, plus the pre-existing optional-handoff test/context follow-up. No production code was changed for this research.

| Owner inspected | Already provides | Does not establish |
| --- | --- | --- |
| `skills/code-review/SKILL.md`, `docs/code-review.md` | Standards/intent axes, independent first reports, evidence challenge, coverage limits | Durable scheduling, fresh contexts for reused people, immutable targets or enforced chunk coverage |
| `docs/pair-programmer.md`, `components/change-reflection/src/index.ts` | Trajectory-following assistance; inherited-context post-run reflection | Independent final-artifact review; shell writes are not all tracked by reflection |
| `components/pi-exec/src/evidence.ts` | Git status/diff/neighborhood collection and bounded evidence composition | Atomic capture; untracked bytes in the patch; persisted sign-off identity |
| `components/browser-pages/src/git-diff.ts` | Actual Git diff, untracked display and commit-based explanation input | A review certificate: ordinary `readRepoDiff` reads a live worktree and uses a branch label for its display head |
| `components/shared/src/work-manager.ts`, `extensions/work.ts` | Extensible `/work` sections and retained selection | A durable review queue owner |
| `components/session-state/src/program-client.ts`, `program-peers.ts`, `runtime.ts` | Temporary root sessions, correlated turns, process ownership and cleanup | Durable background use of a client-owned `pi_exec` scope |
| `components/session-state/src/program-client.ts` context and `runtime.ts` close path | Connection loss closes a program scope; its temporary people are discarded | A guarantee that a job outlives its requesting Pi session |
| `components/session-state/src/work.ts`, `schema.ts`, `links.ts` | Assignments, task threads, single-writer SQLite and result links | Review-specific state, target digests, pass receipts or approval freshness |

The operator's subsequent sign-off changes the UI reuse choice: `/work` is planned for retirement, so the proposal uses a dedicated review interface rather than its section framework. The operator also rejected a custom reviewer restriction/sandbox layer; ordinary advisory-role environments remain the execution model.

The critical integration gap is ownership: a queued review cannot live only inside a foreground `pi_exec` call. The plan proposes a durable review job owned by the existing runtime, with each temporary reviewer attempt still using the existing person/turn/process machinery. That extension requires implementation and crash-recovery tests; it is not an existing API that can simply be called today.

## Not verified

- No comparative defect-detection, false-positive, cost or latency result for these three projects or the proposed system.
- No reproduction of the operator's escaped PR findings or identification of the actual Claude-review workflow/prompt.
- No proof that a model's chunk map discovers every behavioral dependency, that different lenses produce independent errors, or that extra passes improve outcomes.
- No complete security audit of the reference projects, their dependencies, or their agent tool policies.
- No new queue, snapshot, persistent-worker or sign-off implementation in apple-pi.

The proposal's evaluation separates deterministic lifecycle/coverage guarantees from probabilistic review effectiveness. Source-grounded mechanisms justify an experiment and an implementation design, not an accuracy claim.
