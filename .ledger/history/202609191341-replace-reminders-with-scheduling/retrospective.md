Status: complete
Created: 2026-09-19
Updated: 2026-09-19

# Retrospective

## What Mattered

The useful common seam was managed deferred work, not a generic arbitrary-tool scheduler. Prompt delivery and command execution now share IDs, state, cancellation, and lifecycle cleanup while keeping their different wake-up behavior explicit.

Pi Exec's generic extension capture did expose `task` before this change despite the initial expectation. An explicit `schedule` / `task` exclusion and executable catalog test now enforce the intended root-only boundary.

## Learnings

A root object schema with `oneOf` constraints preserves provider-friendly tool parameters while mechanically requiring exactly one prompt or command. Zero-delay prompt delivery remains event-based: it becomes due immediately but waits for `agent_settled`, preserving the old continuation behavior without retaining a second tool.

## Improvements

Repository-wide formatting currently scans generated Graphify cache JSON that does not match Biome output. Changed-file formatting provides valid evidence for this task, but the repository should eventually decide whether generated Graphify caches belong in the formatter input.
