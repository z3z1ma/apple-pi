# 03: Extension tools, fetch, and skills from Python

**What to build:** Python programs can call every captured extension tool (including the MCP gateway) as a type-checked function named after the tool. `tools_list`, `tools_search`, `tools_describe`, and `tools_call` give dynamic discovery. Interactive subagent tools and root-only tools stay excluded. `fetch(url, method=, headers=, body=)` returns status, headers, and text or bytes. It shares the call budget, concurrency, deadline, abort, and trace (header values and request bodies are left out of trace summaries). `skills_list` and `skills_body` return model-invocable skills. The exec documentation covers this surface.

**Blocked by:** 01: Python programs run on Monty with the core tools.

**Status:** done

- [x] A Python program calls the `mcp` gateway and returns its result text.
- [x] Calling an interactive subagent tool or a root-only tool by name fails the type check.
- [x] `fetch` against a local test server returns status, headers, and body. An abort while it is in flight ends the program as cancelled.
- [x] `skills_body` returns a packaged skill body without frontmatter, and fails for an unknown or human-only skill.
