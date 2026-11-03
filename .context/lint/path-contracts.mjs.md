## file

Suffixes mark execution entries, not an inventory of every daemon dependency. Follow the entry's local value-import closure so an ordinary unsuffixed helper cannot introduce a non-erasable declaration or UI dependency. Hot dependency visits carry a separate context flag: importing a helper through both a cold entry and a hot entry must still check the stricter use. Type-only dependencies are erased rather than executed.

Literal worker constructors keep an explicit .worker.ts URL; named/namespace aliases of node:worker_threads are recognized. The checker covers repository-local code, not third-party implementations, arbitrary runtime evaluation or semantic call-graph purity. The direct API-name ban intentionally also rejects imports/aliases before the operation is called. GritQL gives immediate direct-file feedback; this script additionally catches dependency wrappers and computed method access.

The checker reads source files in full because it is a developer lint process, never daemon request handling. Its .mjs extension lets npm lint run it without the runtime loader. TypeScript is already a development dependency. Fixtures execute it over isolated trees and run the actual GritQL plugin through Biome.

Coupled: .pi/rules/hot-bounded-io.grit, .pi/rules/policy.json, biome.json, docs/development.md, components/session-state/src/runtime-main.runtime.ts
Verify: tests/path-contracts.test.ts
