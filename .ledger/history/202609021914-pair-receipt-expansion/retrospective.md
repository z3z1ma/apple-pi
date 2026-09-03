Status: complete
Created: 2026-09-02
Updated: 2026-09-02

# Retrospective

## What Mattered

The useful boundary is the pair's presented trajectory, not general read-only access. Opaque receipts preserve access to collapsed evidence without letting the persistent pair move the viewpoint independently.

## Learnings

Issuance and presentation are separate security states. Tool calls and results can also cross notebook or compaction batches separately, so omitted call payloads need source-precise receipts even when their result is not in the same batch. Page limits must include source labels and continuation framing, not only payload bytes and lines.

## Improvements

Future trajectory projections should identify every intentional omission and decide at that formatting seam whether it needs a capability. Keep source eligibility centralized so notebook generation, recall, and pair projection cannot drift on excluded content.
