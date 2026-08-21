Status: done
Created: 2026-08-15
Updated: 2026-08-15

# Current module-shape and quality-tooling baseline

## Question

Where is apple-pi structurally inconsistent, which large modules genuinely mix responsibilities, and what quality tooling is absent?

## Sources

- `package.json`
- `tsconfig.json`
- `vitest.config.ts`
- `components/advisor/index.ts`
- `components/subagents/src/index.ts`
- `components/subagents/src/agent-manager.ts`
- `components/subagents/src/agent-runner.ts`
- `components/subagents/src/ui/`
- `components/review/src/`
- `components/ralph/src/`
- `components/memory/src/`
- `components/vcc/package.json`
- `components/vcc/src/`
- `extensions/runtime.ts`
- `extensions/runtime-ui.ts`
- `extensions/runtime-tools.ts`

## Method

Counted implementation files and lines, compared component trees and entrypoint conventions, inspected module package boundaries, searched for formatter/linter/complexity/editor configuration, sampled indentation, and distinguished mixed-responsibility entrypoints from cohesive domain controllers. Cross-checked the fresh read-only Explorer report against those measurements and source files.

## Findings

- The strongest mixed-responsibility modules are `components/advisor/index.ts` at about 1,572 lines, `extensions/runtime.ts` at about 951 lines, and `components/subagents/src/index.ts` at about 715 lines. Each combines public registration with substantial runtime, dispatch, formatting, policy, or UI wiring.
- `components/ralph/src/controller.ts` and `components/review/src/controller.ts` are around 620 and 605 lines but are cohesive state-machine controllers with graph, receipt, policy, workspace, role, and mutation responsibilities already delegated.
- Subagents has the clearest UI boundary under `src/ui/`. Review and Ralph currently embed command parsing and simple widget rendering in `src/index.ts`; their upcoming UI work should establish dedicated UI modules before convergence is judged.
- Thin extension wrappers are common, while `extensions/runtime.ts`, `extensions/context.ts`, and `extensions/mcp.ts` are intentional implementation or composition exceptions.
- Root code is ESM/NodeNext and uses `.js` import suffixes. `components/vcc/package.json` deliberately declares CommonJS and VCC uses extensionless imports with Bun tests. This is a real package boundary, not accidental inconsistency.
- Indentation is mixed: most root components use tabs while VCC and some imported areas use two spaces. There is no repository formatter to define or enforce the intended policy.
- There is no lint script, formatter script/config, cyclomatic-complexity check, or `.editorconfig`. Existing gates are typecheck, tests, package loading, and pack dry-run.
- Tests intentionally live in several regimes: root integration tests, memory component tests, VCC Bun tests plus legacy `__tests__`, and an advisor MJS test. Moving all tests would create churn without an observable quality gain.

## Conclusion

Run architecture convergence after the UI and budget APIs settle. Preserve justified component and module-regime differences, but converge entrypoints toward assembly-only roles, extract behavior at demonstrated seams, and add one enforceable formatting/linting baseline. Measure complexity at function boundaries rather than splitting by line count alone.

## Limits

No AST-based cyclomatic-complexity measurement was run because no such tool is installed. Exact extraction boundaries must be planned against the post-UI and post-budget code, not this pre-change snapshot.
