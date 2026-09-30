# Validation

All final commands used the installed repository dependency tree, with the four Pi packages at 0.99.0. No aliases to the global installation, peer overrides, force flags, or legacy-peer flags were used.

- `npm install`: completed. It emitted stale adapter-peer warnings while replacing the old installed tree; adapter was removed from the resulting tree and lockfile.
- `npm ci`: completed from the new lockfile without adapter-peer warnings.
- `npm run check`: format, lint and typecheck passed.
- `npm test`: 98 unit files / 1,103 tests passed; 121/121 offline pair checks passed; package loader passed. Networked pair E2E was not enabled.
- `npm run pack:check`: passed; inspected contents include runtime source and updated MCP docs, and omit the deleted wrapper.
- Packed installation: `npm pack`, ordinary `npm install` of the tarball in a fresh temporary project with all four Pi dependencies pinned to 0.99.0. Loaded all 20 Apple Pi extensions plus native MCP/codemode/tool-search built-ins with no errors or replacement warnings. Started a native stdio echo server from trusted `.pi/mcp.json`; Python returned `echo:PACKED_NATIVE_OK` with native source attribution. Shutdown handlers ran and the process exited normally.
- Native MCP integration tests cover direct, codemode, codemode-deferred and deferred exposure, automatic discovery activation, Python composition, native direct calls and shutdown.
- Child integration tests cover a successful native codemode MCP call and rejection of untrusted project MCP configuration; existing internal consultation/BTW scope tests pass.
- `git diff --check`: passed.
- `graphify update .`: code graph refreshed. Doc semantic extraction and refreshed community labels remain outside this AST-only update.
- `npm audit --omit=dev`: zero vulnerabilities. Full audit reports two moderate development-only entries for Vitest/@vitest/mocker; no unrelated audit fix was applied.

Pi 0.99 changed `loadPromptTemplates` from an array to `{ templates, diagnostics }`. The actual loader test exposed this after aliased unit checks had missed it; the test now consumes the new result and checks diagnostics. Two direct-tool harness contexts were also updated to `ExtensionToolContext`.

## Operator-authorized configuration and OAuth follow-up

The operator then authorized checking and preparing native configuration and OAuth, followed by commit/push. The existing user-global `mcp.json` already contained Atlassian, Slack and Wispr Flow. Native Pi initially loaded all entries without configuration errors, but all required authentication. The file was backed up outside the repository. Slack's adapter-only `auth` field was removed and `oauth.redirectUri` was renamed to native `oauth.callbackUrl`, preserving the client ID and registered loopback address/port.

Native `pi mcp login` completed successfully for all three servers. A fresh `pi mcp list --json` exited zero with zero configuration errors and reported Atlassian connected (41 tools), Slack connected (27 tools), and Wispr Flow connected (14 tools), all with codemode exposure. Credentials remain in the user-global native store, outside Git. No adapter credentials were copied or logged. These live checks establish HTTP connection, native OAuth and tool discovery, not business-tool behavior.

Limits: no real-provider model run, interactive TUI exercise, or live business-tool call was performed. Pi Exec's direct-definition bridge still lacks native exposure/permission semantics; Monty PID termination ownership concerns remain unresolved.
