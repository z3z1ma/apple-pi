# MCP

Apple Pi uses Pi 0.99's built-in MCP support. It no longer installs `pi-mcp-adapter` or registers an MCP gateway. Pi owns server connections, stdio and streamable HTTP transports, OAuth, resources, tool discovery, and the `/mcp` manager.

## Configure and connect

Put personal servers in `~/.pi/agent/mcp.json` and project servers in `.pi/mcp.json`. Project configuration loads only after the project is trusted. Both use an `mcpServers` object:

```json
{
  "mcpServers": {
    "docs": {
      "url": "https://example.com/mcp"
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    }
  }
}
```

Use Pi's shell commands to add and check servers:

```bash
pi mcp add docs --url https://example.com/mcp
pi mcp list
pi mcp login docs
```

Run `/reload` after configuration changes. `/mcp` shows server state, tools, exposure, and sign-in actions. Keep credentials in environment variables or Pi's credential store, rather than in repository files.

## Tool calls and composition

Pi registers each server tool as `mcp__<server>__<tool>`. Server-level `exposure` and per-tool `toolExposure` decide how the model reaches it: `direct` declares the tool like a built-in, `deferred` lets `tool_search` load it on demand, `codemode` (Pi's default) makes it callable only from Pi's native `codemode` scripts, and `hidden` makes it unreachable.

Apple Pi recommends turning native `codemode` off and composing tools with `pi_exec`. `pi_exec` already covers the same need with type-checked Python, model workers, saved programs, budgets, and a durable trace, so a second composition runtime only adds a choice the model has to make on every call. Disable the built-in in `~/.pi/agent/settings.json` and give each server `deferred` (or `direct`) exposure in `mcp.json`, because tools left on the `codemode` default have no other route once the built-in is off:

```json
{ "extensions": ["-builtin:codemode"] }
```

```json
{ "mcpServers": { "docs": { "url": "https://example.com/mcp", "exposure": "deferred" } } }
```

The `pi_exec` bridge captures connected native MCP tools. Use their registered names and schema-checked keyword arguments:

```python
result = await mcp__docs__search(query="sessions")
result["text"]
```

Discover tools with `tools_search(query)`, inspect them with `tools_describe(name)`, and invoke dynamically with `tools_call(name, args)` inside Python. The old `mcp(tool=..., args=...)` gateway and adapter namespace proxies are gone. MCP tools become available after the server connects; Python signatures refresh at cache-safe boundaries.

**Current Pi Exec limitation:** its bridge invokes captured definitions directly. It does not enforce Pi 0.99's exposure rules or dispatch nested `tool_call`/`tool_result` permission hooks. Use ordinary native tool calls when those gates are required. Moving Pi Exec to `ctx.tools`/`ctx.executeTool()` is deferred; native MCP connectivity tests do not establish permission parity.

## Children and SDK sessions

Ordinary interactive children explicitly load Pi's native MCP and tool-search factories alongside their Apple Pi extensions. They do not load `codemode`, so they reach MCP tools through `direct` or `deferred` exposure. Internal BTW, clarification, and consultation sessions remain limited to their existing tools and safety hooks. Pi Exec model workers retain their existing extension scope; they do not gain MCP discovery.

SDK sessions do not discover built-in extensions automatically. Supply Pi's `createMcpExtension()` and `createToolSearchExtension()` through `DefaultResourceLoader.extensionFactories`, then bind the session extensions. The Pi CLI supplies its built-ins itself, which is why the root session needs the settings entry above.

## Migration from the adapter

- Copy supported `mcpServers` entries from adapter configuration into `mcp.json` at the appropriate scope. Native Pi does not read the adapter's `.mcp.json` locations.
- Use stdio or streamable HTTP. Legacy SSE and adapter-specific socket transports are not supported by native Pi.
- Preserve pre-registered OAuth client IDs. Rename the adapter's `oauth.redirectUri` to native `oauth.callbackUrl`, keeping the registered address and port unchanged. Native HTTP OAuth does not require an adapter-specific `auth` field.
- Sign in again with `pi mcp login <server>` or `/mcp login <server>`. Native OAuth uses `~/.pi/agent/mcp-auth.json`; adapter keyring credentials are not migrated automatically.
- Replace gateway calls and `/mcp setup` or `/mcp-auth` workflows with native tool names and Pi's MCP commands.
- Remove any separately installed MCP extension that registers `/mcp`, since it replaces the native built-in. Apple Pi no longer supplies such an extension.

Installing the updated package does not migrate server configuration or credentials automatically. Configuration edits and browser sign-ins are separate operator-authorized steps; credentials remain outside the repository.
