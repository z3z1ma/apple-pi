Status: done
Created: 2026-10-03
Updated: 2026-10-05

# Add coding-child reflections and shared learning

## Intent

Keep automatic engineering discipline when implementation is delegated to write-capable interactive children. Run one in-band pre-settle change-review/learning continuation before handoff, while retaining primary-session passive forks. Share the primary notebook across the delegation tree through validated add-only child and pair contributions, with original cited evidence retained for exact recall.

## Governing record

- [spec.md](spec.md) — operator-confirmed design, user stories, implementation boundaries, and confirmed test seam.

## Acceptance criteria

- Successful child handoffs follow completion of due reflection work and describe the final artifact/validation. Failed or interrupted invocations retain available work and report unfinished reflection without claiming reviewed success. Pairing opt-out does not disable hooks, and resumes do not cause repeat-review loops.
- Child and child-pair additions reach the primary notebook during work, obey add-only authority, and retain original cited evidence after ephemeral children disappear.
- Nested/concurrent contributions, launch/compaction snapshots, explicit reads, cancellation, navigation, failures, and ordinary turn limits satisfy the specification at the confirmed real-SDK integration seam.
- Primary passive reflections and excluded Pi Exec worker behavior remain unchanged.

## Current State

All four tickets are implemented and verified. The operator confirmed fresh real-SDK primary/child/pair seams before test changes, then confirmed the additional primary-fork → public coding-child seam found during final integration review.

Implementation commits:

- `2295a97` — immediate sourced child contributions and exact archived recall.
- `9d085dd` — one in-band pre-settle review/learning continuation per coding invocation.
- `24e247f` — launch and post-compaction shared-learning snapshots, including automatic tool-result and overflow compaction.
- `668b7dd`, `8f89a28` — coding-child pair read/recall, immediate add-only capture, original child evidence, and lifetime revocation.
- `fac8937` — session-relative tracking for real coding children launched inside primary forks, preserving inherited isolation/cancellation and excluding the child's own fork work.

Final independent Standards and Intent/Spec reviews covered ticket 04 and the four-ticket integration boundary. Standards found the inherited fork-marker tracking defect; root reproduced and fixed it. Intent/Spec found no material defect. Corrected affected SDK/regression suites passed 62 tests. Final validation passed formatting, lint, typecheck, all 1,422 unit tests, 118 offline pair tests, extension loading, package dry run, and cache audit. The final run explicitly unset `PAIR_E2E`.

Earlier full-run failures in unrelated timing-sensitive suites passed a separate 102-test rerun. A later ledger-add expectation failed while concurrent ledger-history code was landing; that lane was preserved and its 22-test rerun and the final full validation passed.

## Outcome

Delegated coding work now completes review and learning capture before handoff, with one primary-owned notebook shared across coding children and their pairs. Original cited child evidence remains exactly recallable after ephemeral disposal or later cancellation. Primary passive reflection/curation and excluded execution contexts retain their existing responsibilities.

The operator authorized commits and task closure. No push, publication, or deployment was performed. Live-provider judgment and cache performance remain unverified; scripted native SDK prefix checks and the cache audit are the available evidence. One reviewer accidentally enabled the opt-in pair RPC mode with `PAIR_E2E=0`; it timed out before `agent_start`, was cleaned up, and whether a provider request occurred was unconfirmed. A correct offline rerun passed; this attempt was not counted as validation.

See [retrospective.md](retrospective.md) for lessons and evidence limits.
