Status: complete
Created: 2026-10-13
Updated: 2026-10-13

# Retrospective

## What Mattered

- Pi 1.2's `ctx.tools`/`ctx.executeTool()` let Pi Exec delete its `ExtensionRunner` prototype patch and gain exposure rules, permission hooks, nested usage, and `nestedCalls` records with no code of its own. Most upgrade value was removal, not addition.
- The 1.2 `before_agent_start` union broke exactly one consumer (notify read `event.prompt`); prompt-section handlers needed no change.
- Upstream maps MCP `codemode` exposure to registered `deferred` tools; a test asserting the old mapping failed for an intended reason.

## Learnings

- `ctx.executeTool()` needs an assistant message that issued the parent call. Tests that call a tool's `execute` directly outside a turn get "No assistant message issued this call"; drive the nested path through a real (faux-model) turn instead.
- Pi's text print mode exits 1 on output-token truncation, but `--mode json` does not; Pi Exec workers use JSON mode, so they must read `stopReason: "length"` themselves.
- npm hoisted Pi's dependencies under 1.2, which broke the pair harness's probe for a nested `node_modules`; probe the enclosing `node_modules` too.

## Improvements

- Inactive core tools (and the program's own `bash`) still run directly with the guard applied by `pi_exec`; route them natively only if Pi later lets a tool run a definition it does not list as callable.
