# Implementation continuity

The approved proposal remains authoritative. These are code-level integration notes, not another approval gate.

## Landed

`651d2972` implements capture, types, batch Git I/O, capture fixtures, package inclusion and focused validation. The task is still in progress. Unrelated departure test/context edits and `.pi/LEARNINGS.md` remain unstaged.

## Admission checkpoint

`components/code-review/src/contracts.ts` supplies TypeBox plan/report/finding-validation shapes, region ownership checks, distinct pass identities, risk-required work, complete question accounting and finding-disposition checks. These have not yet been wired to model execution and are not a semantic-quality result.

`review-jobs.ts` is the runtime-owned capture/admission writer. Migration34 adds `review_jobs`; `review` version1 commands go through the existing command journal. Admission survives request closure; restart marks outstanding jobs interrupted. Resume verifies the same artifact and binds the observed owner/generation/revision. Cancel/priority/reassign are implemented; the shared runtime guards prevent departure or a move from abandoning an unfinished review. The read helper follows the existing task-organization semantics.

The latest checkpoint passed 128 focused tests in 13 files, Node/web types, scoped Biome, context lint and package inventory. Eight peer-cleanup failures were reproduced on unchanged HEAD before adding `discard` to the shared file-cleanup owner. Historical finished task evidence remains preserved. See evidence.md for the fixture corrections and exact limits.

## Runtime seam to implement next

- Jobs exist in migration34. Add attempt and append-only decision records through a new forward migration after this checkpoint is committed. The runtime remains the sole writer. Keep the review-domain interpretation and schemas in `components/code-review/`.
- Reuse `openPeerProgram`, `startSession`, `run_turn`, `discard_peer` and existing guarded cleanup. A runtime-owned review controller can own the program connection; the requesting session's connection does not own the job. Persist the job/attempt/scope identity before launch. Runtime restart still closes abandoned program scopes and interrupts attempts; resume must wait for previous scope cleanup, then use a new attempt identity.
- `openPeerProgram(caller, signal, {paths, id})` now supports explicit state/socket access and preselected scope IDs. Its command options accept commandId. Use these from the runtime; explicit socket connection never starts an ambient daemon. Cleanup observation uses the same selected paths. Ordinary Pi Exec calls retain default discovery.
- A `program_open` request can carry the current review/attempt ownership identity. Validate it against the claimed attempt. Its runtime scope starts the peer in the captured source directory and headless, instead of `startSession`'s ordinary caller-cwd/tmux inheritance. Ordinary Pi Exec behavior remains unchanged.
- Review first turns need only the captured target, approved intent/standards, their question and normal role/environment. Trace `prepareStart`/`queueTeamHistory` and startup mail before promising first-input isolation. Fresh UUIDs alone do not establish it. Program peers already start with an empty startup prompt; the correlated `run_turn` begins their actual work.
- A worker saves validated output/observed model and thinking/usage before ordinary peer cleanup. Cleanup failure cannot become a successful completed attempt. The existing `Receipt.result` remains the correlated turn's transient return; review summaries are durable review records, not another transcript.
- Use the current command journal for request idempotency and uncertain mutation recovery. `repeatCommand` already compares canonical inputs and preserves the original caller. Do not repurpose turn result receipts for ordinary review queries.
- Existing runtime tests use isolated `tempStateDir`, `fakeBridge`, the real socket, and `tests/fixtures/peer-pi.mjs` on a scratch PATH. Follow that route before any paid turns. The actual first-provider-input claim additionally needs the faux-session fixture, not merely a fake bridge.

## Scope still open

Finish the durable exact-target review slice, then the semantic/risk/integration/validation pipeline and its result decisions. Integration must inspect residual gaps as well as assigned chunks. Reports are model claims with evidence attribution; schema/coverage checks are not proof of correctness or reproduction.

Then wire native tools, one-tab master-detail `/reviews`, Workplace Code, and captured-artifact sign-off. Retire `/work` UI without removing the task/monitor/reminder or Pi Exec execution owners. Keep Tasks and Pi Exec passive activity types independent of their removed panels.

No production runtime restart, live app activation, reference-engine execution, or paid review has occurred. No acceptance scope has been waived.
