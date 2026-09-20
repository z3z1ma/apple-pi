Status: done
Created: 2026-09-19
Updated: 2026-09-19

# Adopt Pi 0.86.0 safely

## Intent

Prepare Apple Pi for Pi 0.86.0, prove the complete repository against the new package family, and update the Bun-installed global Pi binary only after the checkout is compatible and rollback is ready.

## Success Criteria

- Pin all four Pi development packages and the minimum host contract to 0.86.0.
- Migrate test provider contexts and JSON tool-call fixtures without weakening types.
- Remove the obsolete oversized-result cut-point fallback and private footer layout mutation while retaining automatic-compaction failure safety.
- Resolve or explicitly accept the `pi-mcp-adapter` peer-compatibility gate.
- Pass focused checks, the full repository proof sequence, dependency-tree validation, package inspection, and graph refresh.
- Run `pi update self` only from a committed, clean checkout, then prove a fresh 0.86.0 process loads Apple Pi and its critical integrations.
- Keep a tested 0.85.1 binary/repository rollback path.

## Current State

Implementation and host rollout are complete. Commit `f89fad9` contains the repository migration. The operator explicitly accepted the low-stakes `pi-mcp-adapter@2.34.0` peer-range exception for this personal harness; its focused MCP E2E, full unit suite, loader, and fresh-process extension smoke checks passed.

## Outcome

Apple Pi now develops and tests against Pi 0.86.0, documents Pi 0.86.0 as its minimum host, uses transcript-aware provider test helpers and JSON-specific tool-call fixtures, and expects Pi's capped retry setting. Pi owns oversized-result cut-point selection and zero-row footer sizing; the corresponding Apple Pi workarounds and tests are removed. Automatic-compaction failure safety remains.

Validation passed: formatting, lint, typecheck, 1,057 unit tests, 121 pair tests, loader smoke test, package dry-run, 143 focused compatibility/MCP tests, diff checks, and graph refresh. The expected `npm ls` peer warning remains because adapter 2.34.0 declares Pi AI support only through 0.85.

`pi update self` upgraded the Bun-installed global binary from 0.85.1 to 0.86.0. A fresh 0.86 RPC process loaded Apple Pi from the local package path, reported the pair and MCP statuses, exposed Apple Pi commands, and returned healthy session state without extension errors. The same fresh-host check loaded `git:github.com/Rahularya01/pi-antigravity`; `/antigravity.doctor` completed successfully with its native `streamSimple` transport, no recorded provider error, no tool-schema warnings, and no extension errors. This doctor command proves the provider integration initializes under Pi 0.86 without spending a model call; it does not prove a live Antigravity response stream.
