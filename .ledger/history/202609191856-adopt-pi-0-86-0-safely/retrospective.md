Status: complete
Created: 2026-09-19
Updated: 2026-09-19

# Retrospective

## What Mattered

Auditing the Pi 0.86 source before editing separated real migration work from obsolete defensive code. Testing all four Pi packages together in a disposable checkout exposed both the transcript API changes and the unrelated MCP peer declaration before the live host changed.

A committed repository checkpoint made the host update reversible. The fresh RPC smoke test then proved the new global binary loaded the actual user package and MCP adapter, rather than only proving the local TypeScript suite.

## Learnings

- Pi package upgrades must remain atomic across agent-core, AI, coding-agent, and TUI.
- Provider fakes should inspect transcript messages with Pi's public helpers rather than model legacy session snapshots.
- Native fixes should replace local workarounds when the upstream behavior is covered and the retained safety boundary has independent tests.
- An accepted npm peer-range exception still needs explicit documentation and focused runtime proof.

## Improvements

Recheck the adapter peer declaration during the next dependency refresh and remove the exception note as soon as a compatible release exists. Keep the pre-update disposable-checkout proof and post-update fresh-process RPC smoke in future Pi upgrade plans.
