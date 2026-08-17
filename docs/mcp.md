# MCP

apple-pi installs `pi-mcp-adapter` 2.26.0 and exposes its normal `mcp` tool, `/mcp` setup/status panel, `/mcp-auth`, lazy server lifecycle, metadata cache, stdio/HTTP/SSE/socket transports, OAuth/keyring integration, approvals, output guards, prompts/resources, and MCP UI support. It reads the adapter's standard `.mcp.json`, shared global, and Pi override locations.

Run `/mcp setup` for guided configuration or create `.mcp.json` directly. Single calls use the ordinary gateway:

```javascript
await extensions.mcp({ search: "issues" });
await extensions.mcp({ tool: "github_search_issues", args: { query: "is:open" } });
```

Inside `pi_exec`, the same gateway becomes a programmable capability:

```javascript
const candidates = await extensions.mcp({ search: "fetch issue", server: "github" });
const ids = [101, 102, 103];
return Promise.all(ids.map(async (id) => {
  const result = await extensions.mcp({
    tool: "github_get_issue",
    args: { owner: "acme", repo: "app", issue_number: id },
  });
  return { id, text: result.text };
}));
```

The adapter's separate `mcpScript` VM is intentionally filtered out: `pi_exec` is the one programmable runtime and can compose MCP with Pi core tools, extension tools, and model agents. Direct MCP tools configured by the adapter remain available to ordinary Pi turns and are also discoverable through `pi_exec`'s extension catalog.
