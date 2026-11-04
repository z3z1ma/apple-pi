## file

The composer owns the order and the base sections of the prompt. It must be the last apple-pi extension in `package.json`, so its `before_agent_start` handler sees every section the others contributed.
Why: a section added after it would land outside the stability order.

It reads the live active tools (`pi.getActiveTools()`) and writes them to `selectedTools`, exactly as Pi would after the handlers. The tool list and rules are then built from the tools the request will declare.
Why: other extensions activate tools during their hooks (session-state's work and manager tools). Built from the session-start list, the first version listed about 1,200 characters fewer tools than Pi did. A real-session test caught it; a runner-only test without a session could not, because `getActiveTools` needs a session.
Coupled: package.json

Pi's built-in MCP extension runs after apple-pi's extensions and adds `mcp_servers` last, so Pi keeps that section. Pi always writes `cwd` itself, right after the preamble. A `customPrompt` the user supplied (`--system-prompt`, an intern's prompt) stays the preamble, and then the composer writes no `tools`, `rules` or `docs`, as Pi would not.

Step 1 reproduces Pi's text for `preamble`, `tools`, `rules`, `docs`, `skills` and `project_context` byte for byte; only the order changed. The design and the next steps are in `.ledger/202611032038-custom-system-prompt/vision.md`.
Verify: components/system-prompt/tests/system-prompt.test.ts, tests/system-prompt-sections.test.ts, tests/prompt-budgets.test.ts
