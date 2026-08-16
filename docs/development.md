# Development conventions

## Modules

- Each component exposes a thin `index.ts` entrypoint. It re-exports the component's public API and delegates installation to a cohesive domain module.
- Extension wrappers register Pi integration only. Composition-heavy extensions may keep their installer together when lifecycle state is shared; independently testable formatting, persistence, worker, fetch, and dispatch code belongs in named sibling modules.
- Controllers, services, and algorithms stay whole when their state and dependency direction are cohesive. Split a module only at a production consumer, a test seam, or a one-way dependency boundary—not because it is long.
- UI rendering belongs in the component's `ui/` modules. Review and Ralph keep their own UI presentation; they do not share a generic fleet, overlay, status, or progress abstraction.
- Root ESM TypeScript uses NodeNext imports with `.js` suffixes. The VCC package is an intentional CommonJS/Bun boundary: retain its extensionless imports and its local test regime.
- Tests remain adjacent to their owning regime: root integration tests under `tests/`, memory tests under `components/memory/tests/`, advisor's loader harness under `components/advisor/`, and VCC's Bun tests under `components/vcc/`.

## Retained cohesive modules

`AdvisorRuntime`, Pi Exec's invocation controller, `agent-runner.ts`, `agent-manager.ts`, Review/Ralph controllers, and VCC algorithms remain intact because they each own a single state machine or algorithm with shared lifecycle state. Splitting them by file length would obscure ownership without creating a consumer or test seam.

## Quality commands

```bash
npm run format
npm run format:check
npm run lint
npm run typecheck
npm test
npm run pack:check
```

Biome is the repository formatter and lint runner. It formats root ESM code with tabs and preserves VCC's two-space CommonJS/Bun boundary through one shared configuration. `format:check` is the no-write CI check; `lint` enables Biome's recommended correctness rules, high-signal debugger and loose-equality checks, and a function-level cognitive-complexity limit of 50. `noExplicitAny` remains off for the Pi API's intentionally untyped generic boundary, non-null assertions remain off in existing test setup, and control-character regex detection remains off because ANSI/control-character sanitizers are intentional. Any complexity suppression must document the specific cohesive state-machine or algorithm boundary it protects.
