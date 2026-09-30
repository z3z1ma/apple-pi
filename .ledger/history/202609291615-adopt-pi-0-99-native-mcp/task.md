Status: done
Created: 2026-09-29
Updated: 2026-09-29

# Adopt Pi 0.99 native MCP

## Intent

Adopt Pi 0.99's native MCP support in root and ordinary child sessions. Remove the adapter and its packaging blocker. Keep Pi Exec unchanged pending a separate decision about its value.

## Current State

Implementation and validation complete. Evidence: [validation.md](validation.md). The separate runtime decision remains open: [runtime-options.md](runtime-options.md).

Acceptance:
- Four Pi development pins are 0.99.0; peer requirements reflect the new minimum. Lockfile resolves without overrides or legacy-peer flags.
- Apple Pi no longer installs or loads pi-mcp-adapter or overrides native /mcp.
- Native MCP connects from trusted mcp.json, works directly and through existing Pi Exec, and remains available in ordinary children without widening internal-session scope.
- Relevant tests, full checks, clean npm ci and packed installation are exercised with actual 0.99 dependencies.
- Docs explain config/auth migration and deferred Pi Exec policy limitations.

Scope: no Pi Exec removal or nested-tool bridge redesign. A subsequent operator request authorized user-global native MCP configuration and OAuth sign-ins, plus commit/push.

## Outcome

Pi development pins and minimum peers now require 0.99.0. Adapter dependency/wrapper removed; root native MCP is no longer overridden. Ordinary SDK children explicitly receive native MCP/discovery factories; internal-session scope is preserved. Clean install, full checks and packed native-MCP/Python smoke passed. The operator-authorized follow-up prepared the existing native configuration and completed native OAuth sign-ins for Atlassian, Slack and Wispr Flow. A fresh native status check reports all connected, with zero errors; credentials remain outside the repository. Pi Exec removal and nested-tool bridge redesign remain deferred.
