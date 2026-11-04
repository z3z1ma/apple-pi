## file

The composer writes the prompt's preamble (the operating model in `preamble.ts`), the toolbox, a short pointer to Pi's docs, the skills and the project context, and orders every section from most stable to most personal. It must be the last apple-pi extension in `package.json`, so its `before_agent_start` handler sees every section the others contributed.
Why: a section added after it would land outside the stability order, and stable text first keeps the longest prefix identical across sessions.

It reads the live active tools (`pi.getActiveTools()`) and writes them to `selectedTools`, exactly as Pi would after the handlers, so the toolbox teaches the tools the request will declare.
Why: other extensions activate tools during their hooks (session-state's work and manager tools, the pair's tool). Built from the session-start list, the first version listed about 1,200 characters fewer tools than Pi did. A real-session test caught it; a bare `ExtensionRunner` cannot, because its `getActiveTools` throws without a session, so harnesses that run `before_agent_start` without a session stub `getActiveTools`/`setActiveTools`.
Coupled: package.json, tests/system-prompt-sections.test.ts, components/pair-programmer/tests/pair.test.mjs

Pi's built-in MCP extension runs after apple-pi's and adds `mcp_servers` last, so Pi keeps that section. Pi always writes `cwd` itself, right after the preamble. A `customPrompt` the user supplied (`--system-prompt`) stays the preamble, and then the composer writes no toolbox or docs, as Pi would write no tools, rules or docs. Interns pass `--intern` and get the short intern preamble with the full toolbox for their tools.

Intern detection is a flag the runner passes, not an inference from missing sections: an ordinary root session with the session-state bridge switched off also has no organization.
Coupled: components/interns/src/runner.ts, tests/helpers/prompt-budget.ts

The composer computes the project facts the rooms depend on (whether `.wiki/` exists in `cwd`); components contribute tools and person facts, not prose about how to use them. The ledger and the wiki are taught in the record room, not in sections of their own.

Each context is a `Frame`: root sessions get the operating model and the goal flow, interns the intern preamble and no flow. `/btw` loads no package extensions, so it adds the composer itself as an extension factory, `systemPromptComposer(() => ({ preamble: PROMPT, docs: false }))`: its own preamble, the same toolbox, and no pointer to Pi's docs. Its loader keeps `systemPromptOverride` returning undefined, because a discovered `SYSTEM.md` would become `customPrompt` and switch the toolbox off.
Coupled: components/btw/src/session.ts

The design and the next steps are in `.ledger/202611032038-custom-system-prompt/vision.md`.
Verify: components/system-prompt/tests/system-prompt.test.ts, tests/system-prompt-sections.test.ts, tests/prompt-budgets.test.ts

## symbol:toolboxSection

The toolbox describes the place as rooms (`TOOL_GROUPS` in `toolbox.ts`), each a list of lines that name their tools in backticks. A room appears only when one of its tools is active, and a line that names an inactive grouped tool is dropped, so no session is told about a tool it cannot call. Write each line so that the tools it names are active together in every posture: a line naming one present and one absent tool drops both, and the posture test then reports the present one untaught. Name a shell command that shares a tool's name (`find`, `ls`) without backticks. A tool no group knows (MCP, another package) is listed with its own snippet and guidelines.
Why: tools appear and disappear by posture (manager tools for managing roles and unroled roots, desk tools for managers and the scout, the pair tool while the pair is on). The real-session test checks that every active tool is taught and no taught tool is absent.
Coupled: components/system-prompt/src/toolbox.ts
