## file

A saved program runs in its own `CodemodeSandbox` from `@earendil-works/pi-codemode`, with every tool in `ctx.tools` bridged through `ctx.executeTool`. It cannot go through the built-in `codemode` tool: that tool's exposure is `model-only`, so `ctx.executeTool("codemode")` is refused. The package depends on `pi-codemode` directly because Pi's extension loader aliases only its core packages, not this one; keep its version equal to the host Pi's.
Why: the first version ran programs through `ctx.executeTool("codemode")` and every call failed with the tool missing from `ctx.tools`.

The header is a `// @program: {json}` directive line, not a doc comment: repositories that forbid comments (this one does) still allow directives, and the comment detector exempts `// @program:` and codemode's `// @options:`. `// @options:` must be the script's first line, so `programScript` moves it ahead of the injected `const inputs = …` line.

Discovery skips malformed programs without running them, reads only regular `.js` files inside the project's `.pi/programs/`, and runs only in a trusted project. Schemas register on session start, on compaction, and before a turn only while the branch has no messages, so a registered schema never changes mid-conversation and the provider prefix survives.
Coupled: components/repo-rules/src/comments.ts, components/system-prompt/src/toolbox.ts, package.json
Verify: components/programs/tests/programs.test.ts
