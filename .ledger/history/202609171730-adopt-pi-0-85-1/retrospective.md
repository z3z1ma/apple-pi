Status: done
Created: 2026-09-17
Updated: 2026-09-17

# Retrospective

## What Mattered

The host was already 0.85.1. The remaining work was pin honesty, not installing Pi. The MCP bump is a peer-alignment pin, not a new Apple Pi MCP surface. The working spinner did not need a product change.

## Learnings

`pi-mcp-adapter` ships `.ts` as `exports.types` / `import`. Apple Pi typechecks that graph. 2.34.0 iterates DOM `Headers` and `ReadableStream`; the previous `ES2023` + `DOM` libs were not enough. Completing `DOM.Iterable` and `DOM.AsyncIterable` unblocked typecheck without stubbing the adapter.

## Improvements

When the next adapter pin fails typecheck, check whether it is still DOM lib completeness before writing a local declaration stub.
