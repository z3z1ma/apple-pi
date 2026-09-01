Status: done
Created: 2026-08-31
Updated: 2026-08-31

# Assess Pi 0.84.4 opportunities for Apple Pi

## Intent

Assess Pi 0.84.3–0.84.4 against Apple Pi's current extension surface and identify concrete upgrades, deletions, migration risks, and YAGNI items from primary sources.

## Success Criteria

- Compare the official changelog, documentation, and implementation with the installed 0.84.2 package.
- Map relevant changes to Apple Pi's compaction, pair, tmux, xAI, RPC, subagent, and usage surfaces.
- Validate that the current tree can load and test against Pi 0.84.4 without modifying the working repository.
- Record a prioritized, evidence-backed recommendation.

## Current State

Research complete. Findings are in `research.md`.

## Outcome

Recommend upgrading the aligned Pi package family to 0.84.4, using native same-run post-tool compaction for the normal path, gating native failures after `session_compact_failed`, and inserting a hidden custom-message cut point for the proven over-budget gap. Also adopt UI prompt lifecycle events for tmux waiting status and consume `session_compact_failed` for notification correctness. Keep the notebook policy, xAI compaction, hosted-tool injection, subagent queues, and usage accounting; an integration check confirmed internal summarization bypasses the hosted-tool payload hook. A temporary 0.84.4 dependency upgrade passed typecheck, 898 unit tests, 112 offline pair tests, loader validation, and package dry run.
