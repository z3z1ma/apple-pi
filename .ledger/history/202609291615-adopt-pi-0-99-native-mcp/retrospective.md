Status: complete
Created: 2026-09-29
Updated: 2026-09-29

# Retrospective

## What Mattered

Native MCP removed a dependency conflict and duplicate ownership without requiring a Pi Exec rewrite. Existing Python composition still works, but connectivity is distinct from native permission parity.

## Learnings

SDK sessions need explicit native extension factories. `noExtensions` suppresses discovery, not unnamed inline factories; omit them for internal sessions. Preserve native discovery activation instead of promoting every registered tool. Actual clean-tree loader validation caught a prompt-template return-shape change that global aliases had missed.

## Improvements

Keep the runtime decision separate from this completed migration. Prefer native composition unless Python/static checking or interpreter persistence is a demonstrated requirement. Preserve useful workers/evidence as capabilities rather than treating the whole custom interpreter as indivisible.
