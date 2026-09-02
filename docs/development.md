# Development conventions

## Modules

- Extension-facing components expose a thin `src/index.ts` entrypoint. It re-exports the component's public API and delegates installation to a cohesive domain module; library components expose their named modules directly.
- Extension wrappers register Pi integration only. Composition-heavy extensions may keep their installer together when lifecycle state is shared; independently testable formatting, persistence, worker, fetch, and dispatch code belongs in named sibling modules.
- Controllers, services, and algorithms stay whole when their state and dependency direction are cohesive. Split a module only at a production consumer, a test seam, or a one-way dependency boundary—not because it is long.
- UI rendering belongs in the owning component's `ui/` modules; do not create generic fleet, overlay, status, or progress abstractions without multiple production consumers.
- TypeScript uses NodeNext imports with `.js` suffixes throughout the repository.
- Components place production TypeScript in `src/` and component-specific tests in `tests/`; root integration tests remain under `tests/`. Third-party attribution and license text are centralized in `THIRD_PARTY_NOTICES.md`.

## Retained cohesive modules

`PairRuntime`, Pi Exec's invocation controller, `agent-runner.ts`, and `agent-manager.ts` remain intact because they each own a single state machine or algorithm with shared lifecycle state. Splitting them by file length would obscure ownership without creating a consumer or test seam.

## Skill composition

Pi loads every skill into its resource catalog, but removes `disable-model-invocation: true` skills from the model's automatic system-prompt catalog. A user's `/skill:<name>` command still resolves against the full catalog and expands the chosen body with its absolute location and base directory.

Choose the composition path by intent:

- When one packaged skill needs another procedure during the current run, use an explicit relative Markdown link such as `../interrogate-to-design/SKILL.md` and tell the model to read and follow it. This anchors the compatible packaged procedure and works whether the target is model-visible or human-only. The parent invocation owns the authorized workflow scope; the referenced skill supplies procedure.
- When prose only routes a future request toward a model-visible skill, its installed name is enough because Pi's system-prompt catalog supplies the trigger and absolute path.
- When the next workflow requires a separate human invocation, report `/skill:<name>`. This lets Pi expand model-visible or human-only targets through the full resource catalog without implying that the current skill invoked them.
- When only one supporting procedure is needed, link that exact reference file rather than loading its complete parent skill.

Pi Exec's `skills.list()` and `skills.body()` remain introspection APIs for model-visible skills only. Direct skill-to-skill references need no runtime invocation bridge.

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
