Status: done
Created: 2026-09-01
Updated: 2026-09-01

# Adopt Pi 0.84.4 safely

## Intent

Adopt Pi 0.84.4 through Apple Pi's repository contract while preserving fail-closed oversized-continuation behavior and integrating the new lifecycle APIs where they replace local special cases.

## Success Criteria

- Pin the four Pi development packages to 0.84.4 while keeping required peer dependencies at `*`; document that operators update the host with `pi update` / `pi update self`.
- Prove native same-run pre-response compaction succeeds before the next provider request.
- Prove `session_compact_failed` plus a narrow Pi 0.84.4 compatibility gate stops failed or cancelled automatic compaction before provider dispatch; use a hidden custom-message cut point for the proven over-budget gap.
- Prove whether internal compaction and branch-summary calls traverse `before_provider_request`; keep xAI hosted tools out of explicit no-tool summarization payloads while retaining ordinary-request injection.
- Use `ui_prompt_start` / `ui_prompt_end` for tmux waiting status.
- Prevent compaction failures from producing stale successful macOS completion notifications.
- Exercise the actual pair-programmer `triggerTurn: false` advisory path after tool results.
- Pass formatting, lint, typecheck, relevant/full tests, loader validation, and package dry run.

## Current State

Implementation and validation are complete. Pi development dependencies are pinned to 0.84.4. Native success/failure/cancellation and the retained oversized-result fallback have behavioral coverage. xAI hook reach for ordinary, compaction, and branch-summary calls and pair advice ordering are proven. Tmux prompt lifecycle and notification failure state are implemented with focused tests. Documentation is aligned.

## Outcome

Apple Pi now targets Pi 0.84.4 while keeping the Pi peer contract open. Native compaction owns the normal same-run path; public failure events plus a narrow compatibility gate stop failed or cancelled continuations, and an empty hidden custom message supplies the proven over-budget cut point without replacing providers or persisting a synthetic assistant. Generic UI prompt events drive tmux waiting state, notification state reflects compaction failures, and behavioral tests cover pair advice ordering and the xAI raw-summary boundary. Repository checks, 916 unit tests, 112 pair tests, loader validation, and package dry run pass.
