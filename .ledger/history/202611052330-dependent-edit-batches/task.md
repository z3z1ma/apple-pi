Status: done
Created: 2026-11-05
Updated: 2026-11-06

# Refuse dependent file checks beside parallel edits

## Decision requested

Approve or decline adoption of the candidate on `capability/edit-batch-guard`, built in `/tmp/apple-pi-mateo-batching`. This is an outcome sign-off, not permission for a background self-editing process. Nothing changes on main before approval.

## Intent

A file check sent in the same assistant message as its edit can read the old file. The existing guard refuses git staging/commit beside edits, but not a same-file read, grep, formatter or test. Prose has not stopped the wider mistake.

The candidate refuses a top-level read of a concurrently edited path, a shell call with that path as a literal argument, and all edits/writes that collide on one path. Unrelated paths and sequential messages remain allowed. Shell detection is best-effort: literal mentions can be independent, and indirect imports, globs, variables, scripts and nested codemode calls are outside the guarantee. Its refusal asks for the dependent call in the next message; it does not run or reorder the batch itself.

## Acceptance

- The behavior window is derived from the actual batching code and prompt lines.
- A retained recorded-batch scan calls the production matcher and lists every proposed refusal as metadata and transcript references, with manual classification and limits.
- Focused tests cover same-file conflicts, independent work, lifecycle clearing and unusual legitimate paths. At least one regression test fails on the previous implementation.
- A design model checks arbitrary call ordering for recognized dependencies and a deliberately disabled guard fails its control.
- Independent captured review challenges missed cases, wrong refusals and evidence loss. Every material finding is answered.
- Operator approves this outcome before adoption on main. A decline is recorded and closes the candidate without adopting it.

## Evidence boundary

Tadhg clarified in task message communication:5b676d456dfdebaa95332decfab2185378ada731a40660623b5f78115017a7f8 that unrelated tool additions do not reset this behavior's window. `git log -L` finds:

- edit/write toolbox line: e2db6816, 2026-11-04T06:54:52Z;
- commit-beside-edit guard: 7686406e, 2026-11-03T06:37:17Z;
- parallel-calls learning: eaa8e5e2, 2026-11-04T16:01:52Z.

The latest is **eaa8e5e2**, the discovery/scan start. Scan end is fixed at **2026-11-06T06:28:36Z**, before candidate development. Raw session access for this read-only scan was authorized by the organization root in task message communication:b1f9bd0fcac7d7304d9a8fbe0eeb40f19a24d6c31b838e869ef46810fdf985a1. Retained evidence contains metadata only, not private messages, commands, outputs or file contents.

## Current State

Candidate built on `capability/edit-batch-guard`: initial implementation 73e95c72, repairs 7da47ad6, sign-off bundle 85dc48b1. The operator approved `sign_off_task` on 2026-11-06 with no notes. The approved implementation and evidence are adopted onto main with this bundle; only runtime wording was shortened during integration to keep the existing prompt budget.

- Revised production scan: **59 matched / 1,200 batches**, including **2 already-refused staging batches**, in the original fixed window. This shows 57 proposed new deferrals, not 57 proven stale results. `evidence.md` and `scan-results.json` retain the occurrence metadata and limits.
- Independent review `review-6447efe0-3f56-4f7b-bb17-cefbf2c34203` completed 4 passes / 8 questions. All **11 distinct confirmed findings** are repaired and answered; summary revision 20 reports 11/11 responded, addressed=true. Repairs are **fixed-claimed**, not independently re-verified.
- Author checks: **54 focused Vitest tests**, **4 scanner tests**, typecheck, loader, Biome, and **651-file context lint** pass. Three real-SDK regressions and all four scanner regressions fail on the reviewed commit and pass after repair. The finite design model and disabled-guard control are recorded in `evidence.md`.
- The operator directed fixes and closure without another full review round, relayed by Tadhg in communication:cf77b5cd4bfba2919f183eefb1e383af2b6b506efa8efeb4ce9bec26fa2183ba.

## Recommendation and trade-off

**Approve the limited guard.** It deterministically defers recognized same-file checks and colliding writers at the shared dispatch boundary, with concise runtime guidance. It preserves independent paths and leaves an invalid sibling to its own tool's error path. It uses the existing fork/session projection rather than shared batch state.

The cost is conservative deferral: reading another section of the same file, printing its name or reading historical git data may also be refused. The scan cannot establish intent or a future false-positive rate. Shell matching remains a literal-argument heuristic, not dependency analysis; indirect imports, directory-wide tests, globs, variables, scripts, symlink aliases and nested codemode calls remain outside its guarantee. A refused check does not stop its sibling edit.

Approval allows committing only this candidate's files onto main and closing its ledger bundle. The guard will load in newly started/reloaded Pi sessions; it does not start or restart a daemon, add state migrations or modify project activation. Existing sessions keep their loaded code. Declining will retain the evidence and close the proposal without adopting its harness code.

## Outcome

Approved and adopted. The sign-off tool returned approval with no annotations; it reported the six Markdown documents as unopened, so approval is not evidence that each document was read. Saved page: `/Users/alexanderbut/.pi/agent/artifacts/apple-pi-mateo-batching/2026-11-06-refuse-dependent-file-checks-beside-parallel-edits.html`.

Final main checks: 55 focused Vitest tests, four scanner tests, typecheck, loader, seven-file Biome and 651-file context lint pass. Root prompt measures 34,367 estimated tokens against the unchanged 34,384 ceiling after concise wording and consent-preserving opt-in guidance. Source behavior and replay counts are unchanged. No new review round, full suite, live provider test or daemon restart ran. Repairs remain author-tested, not independently re-captured.
