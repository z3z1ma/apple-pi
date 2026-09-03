Status: done
Created: 2026-09-02
Updated: 2026-09-02

# Deepen pair collaboration and image visibility

## Intent

Deepen the persistent pair's navigator behavior without restoring independent navigation: let `share_note` carry a restrained probing question or request for the driver to expose missing evidence, simplify the behavioral prompt around frontier judgment and calibrated certainty, and let the pair open user-supplied images through source-bound receipts.

Success criteria:

- `share_note` remains the sole direct pair-to-driver channel and can carry a concrete finding or one precise question/view request when missing evidence could materially change judgment.
- Restraint remains model judgment guided by a compact prompt; no arbitrary quota or heuristic is added.
- User images appear in trajectories as opaque on-demand receipts, never inline data, and image-only user messages remain visible.
- Expanding a user-image receipt returns the original ordered image blocks through Pi's normal tool-result path with primary source provenance.
- Presentation gating, active-lineage checks, lifecycle revocation, immutable snapshots, and transactional pair effects remain intact.
- The pair tool allowlist does not grow and repository or transcript navigation is not restored.
- Focused and full repository validation pass.

## Current State

Complete. The pair uses a compact navigator prompt centered on independent frontier judgment, calibrated certainty, and restraint. `share_note` can carry either a finding or one precise evidence question without adding another tool or queue.

## Outcome

Added transactional, frontier-confirmed pair questions; source-bound on-demand receipts for text-plus-image and image-only user messages across live turns, seeds, compaction, active context, notebook source batches, and known-note recall; and pair-specific recall guidance without forbidden search instructions. Pi returns expanded images through normal tool-result image blocks, with text-only pair models receiving Pi's standard placeholder. Also fixed consultant request admission so unavailable managed consultation is reported before transactional staging.

Validation passed: `git diff --check`, `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test` (89 files / 932 Vitest tests, 120 offline pair tests, loader smoke test), and `npm run pack:check`.
