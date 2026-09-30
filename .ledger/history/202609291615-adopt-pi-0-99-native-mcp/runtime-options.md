# Pi Exec decision: still open

The operator authorized the Pi 0.99/native-MCP migration, not removal or redesign of Pi Exec.

## Actual overlap

Pi 0.99's `docs/cli.md` and `dist/extensions/codemode/tool.js` establish that native codemode already supplies sandboxed JavaScript tool composition, parallel calls, result filtering, live TypeScript declarations, dynamic discovery, optional hard deadlines, output capture, and branch-persistent JSON through `store`/`load`. It calls tools through Pi's supported nested-tool pipeline, including exposure, argument validation, permission hooks, execution events, nested-call records, and usage accounting.

Apple Pi's current Python runtime supplies equivalent general composition on Monty, with always-on static checking, host call/concurrency/worker budgets, worker composition, evidence/context helpers, fetch/skill discovery, saved Python programs, full interpreter checkpoints, and its own traces/UI. It still captures registered definitions and calls them directly. The Monty PID termination ownership/race concern remains unresolved; this migration does not fix it.

## What really needs a separate interpreter?

- Python syntax and Monty's static checking.
- Persistence of interpreter globals and function definitions, rather than JSON data.

Model-worker composition, evidence/context helpers, saved workflows, call budgets and result presentation are not inherently Python features. They could become ordinary tools or workflow instructions callable from native codemode. That is an implementation possibility, not a validated replacement yet. Native `models.classify` is not a replacement for arbitrary LLM workers.

## Recommendation for discussion

Prefer native codemode for ordinary tool/MCP composition. Keep Pi Exec temporarily so existing review/Ralph Python programs remain functional. Before paying for another bridge rewrite, choose whether Python and full interpreter persistence are important product requirements.

If not, inventory and preserve useful model-worker/evidence behavior as small native tools, migrate real review/Ralph consumers, then remove the custom interpreter/checkpoint/cancellation stack. If yes, retain Pi Exec and use `ctx.tools`/`ctx.executeTool()` rather than prototype capture. Neither path is implemented or authorized by the current migration.

## Sources

- Installed Pi 0.99: `docs/cli.md`, `docs/extensions.md`, `docs/sdk.md`, `dist/extensions/codemode/tool.js`.
- Apple Pi: `docs/exec.md`, `extensions/runtime-tools.ts`, `extensions/runtime-agent.ts`, `extensions/runtime-evidence.ts`, `extensions/runtime-implementation.ts`, and Python programs under `skills/code-review/references/` and `skills/ralph/references/`.
