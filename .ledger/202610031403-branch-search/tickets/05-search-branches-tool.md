# 05: `search_branches` tool for the main agent

**What to build:** The main agent can start a search with the `search_branches` tool (spec 5.2). The call blocks until the search ends and returns the report body as its tool result. Role forks and generation-0 branches start from the parent conversation including the assistant message that holds the call, with a tool result for that call carrying each fork's prompt, so they share the parent's cache (I4, section 9). Progress streams through tool updates (13).

**Blocked by:** 04 (`/branch-search` with a hidden authored scorer).

**Status:** ready-for-agent

- [ ] A `search_branches` call blocks until the search ends and returns the report body as its tool result; the parent conversation gains no other message (I7).
- [ ] Every role fork and generation-0 branch request starts with the parent's request through the assistant message that holds the call, followed by a tool result for that call that carries the fork's prompt.
- [ ] While the search runs, the tool streams progress updates in the status format.
- [ ] Aborting the tool call cancels the search and cleans up.
- [ ] A call while a search runs returns "Branch search <id> is already running." at once.
- [ ] Inside any fork, a `search_branches` call returns the blocked-tool message.
- [ ] A `search_branches` call that shares its assistant message with other tool calls either produces valid fork requests or returns an error that asks for the call on its own.
- [ ] The docs page, README catalog, and loader test include the tool.
