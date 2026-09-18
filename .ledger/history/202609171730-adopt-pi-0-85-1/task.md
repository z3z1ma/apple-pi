Status: done
Created: 2026-09-17
Updated: 2026-09-17

# Adopt Pi 0.85.1 host pins

## Intent

Align Apple Pi's development pins with the operator's already-running Pi 0.85.1 host. Bump `pi-mcp-adapter` to a 0.85-aware peer. Leave the input-card working spinner standalone.

## Success Criteria

- Pin `@earendil-works/pi-agent-core`, `pi-ai`, `pi-coding-agent`, and `pi-tui` to exact `0.85.1`. Keep `peerDependencies` at `*`.
- Pin `pi-mcp-adapter` to `2.34.0`. Continue filtering `mcpScript`. Do not copy adapter source.
- Do not set `embedWorkingStatus`. The standalone working row stays as-is.
- Document minimum host as Pi 0.85.1. Update MCP pin docs and third-party notices.
- Pass format, lint, typecheck, unit tests, pair tests, loader, MCP e2e, and pack dry-run.

## Current State

Pins, adapter, README, MCP docs, notices, and tsconfig lib list are updated. Working spinner is unchanged.

## Outcome

Checkout now typechecks and tests against Pi 0.85.1 with `pi-mcp-adapter` 2.34.0. The working indicator was left standalone.
