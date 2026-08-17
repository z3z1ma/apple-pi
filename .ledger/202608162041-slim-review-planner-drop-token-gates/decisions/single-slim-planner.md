Status: active
Created: 2026-08-16
Updated: 2026-08-16

# Keep one slim planner

## Context

The live planner already produced a valid overlapping group/focus graph, then spent 6m 46s doing it. The planner currently receives fair excerpts, a sealed-diff chunk reader, reviewer-like repository tools, and high fallback thinking. The operator said planning should classify files into cohesive groups and bounded focuses from the file list, rough diff contents, and parent context. They also floated a map-reduce in which the first planner emits groups and later planners emit focuses.

## Decision

Keep exactly one planner invocation. Give it:

- the selected-item manifest;
- short controller-owned excerpts, not complete diffs;
- optional parent background and authority context;
- the `maxGroups` and `maxFocuses` caps.

Do not admit `read_sealed_review_diff`. Do not add group-local focus planners. Do not ask the planner to reconstruct deleted content or investigate defects. Keep a capable planner model route, but set planner thinking to low.

Reviewers remain the only roles that read complete assigned diffs and repository evidence.

## Authority And Provenance

- User-ratified: planning is classification; the planner should not pre-review.
- User-ratified: a second planner wave is an idea, not a required design. The useful knob is a known group/focus cap.
- Research: `.ledger/202608162041-slim-review-planner-drop-token-gates/research/live-planner-bottleneck.md`.

## Alternatives Considered

### Map groups to child focus planners

This matches the operator's map-reduce sketch and could give each group a smaller context. It adds a mandatory model phase after a planner that already emitted focuses, increases wall-clock, and repeats the failure mode of planning becoming investigation. The live run's planner was slow and already complete; later work died on token admission, not missing focus quality.

### Keep the sealed-diff reader and ask the planner to use it less

The tool exists specifically to pull complete old/deleted chunks. Leaving it admitted keeps the quota defect and keeps inviting pre-review. Prompt-only restraint is weaker than removing the tool.

### Drop focuses and review whole groups

This shrinks planning further but discards the already-built focus scheduler, overlap completion rules, and conservative merge. The operator asked to slim planning, not to undo focus review.

## Consequences

- `plannerPrompt`, the planner skill, and `ReviewController.plan` lose the reader and complete-diff instructions.
- Tests that require `read_sealed_review_diff` or lossless planner reconstruction are deleted or rewritten around short excerpts.
- Planner quality now depends on filenames, short excerpts, and parent context. Reviewers carry the investigation burden.

## Limits And Revisit Conditions

Revisit a second planner wave only if measured planner output is too coarse after the slim contract and a bounded child-planner design has a latency budget that still beats one overloaded planner. Do not add that phase because the idea was discussed.

## Related Records

- `.ledger/202608162041-slim-review-planner-drop-token-gates/specs/slim-planner-and-review-limits.md`
- `.ledger/202608162041-slim-review-planner-drop-token-gates/research/live-planner-bottleneck.md`
