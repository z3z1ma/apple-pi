Status: done
Created: 2026-09-19
Updated: 2026-09-19

# Retrospective

## What Mattered

Testing the upgrade in an isolated repository separated real compatibility work from changelog speculation. Production code compiled; the concrete breaks were test providers that still read legacy `Context` fields, one non-JSON fixture type, and an expected retry-settings object.

The source tests behind Pi's compaction fix were important. They showed that Apple Pi's hidden cut-point injection now duplicates native behavior rather than protecting a remaining gap.

## Learnings

- A successful typecheck is insufficient for Pi upgrades because faux providers encode provider-facing API assumptions at runtime.
- Upstream bug fixes should trigger a search for local workarounds, especially code that reaches into private UI or session internals.
- A package can compile and pass behavior tests while the dependency tree remains formally unsupported through a stale peer range.

## Improvements

For the implementation pass, apply the migration as one coherent change and rerun the full proof sequence. Check `pi-mcp-adapter` metadata first so work is not merged into an invalid peer tree.
