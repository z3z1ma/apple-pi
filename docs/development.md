# Development conventions

## Modules

- Extension-facing components expose a thin `src/index.ts` entrypoint. It re-exports the component's public API and delegates installation to a cohesive domain module; library components expose their named modules directly.
- Extension wrappers register Pi integration only. Composition-heavy extensions may keep their installer together when lifecycle state is shared; independently testable formatting, persistence, worker, fetch, and dispatch code belongs in named sibling modules.
- Controllers, services, and algorithms stay whole when their state and dependency direction are cohesive. Split a module only at a production consumer, a test seam, or a one-way dependency boundary—not because it is long.
- UI rendering belongs in the owning component's `ui/` modules; do not create generic fleet, overlay, status, or progress abstractions without multiple production consumers.
- TypeScript uses NodeNext imports with `.js` suffixes throughout the repository.
- Components place production TypeScript in `src/` and component-specific tests in `tests/`; root integration tests remain under `tests/`. Third-party attribution and license text are centralized in `THIRD_PARTY_NOTICES.md`.

## Retained cohesive modules

`AdvisorRuntime`, Pi Exec's invocation controller, `agent-runner.ts`, and `agent-manager.ts` remain intact because they each own a single state machine or algorithm with shared lifecycle state. Splitting them by file length would obscure ownership without creating a consumer or test seam.

## Quality commands

```bash
npm run format
npm run format:check
npm run lint
npm run typecheck
npm test
npm run pack:check
```

Biome is the repository formatter and lint runner. It formats all TypeScript and JavaScript with tabs through one shared configuration. `format:check` is the no-write CI check; `lint` enables Biome's recommended correctness rules, high-signal debugger and loose-equality checks, and a function-level cognitive-complexity limit of 50. `noExplicitAny` remains off for the Pi API's intentionally untyped generic boundary, non-null assertions remain off in existing test setup, and control-character regex detection remains off because ANSI/control-character sanitizers are intentional. Any complexity suppression must document the specific cohesive state-machine or algorithm boundary it protects.
