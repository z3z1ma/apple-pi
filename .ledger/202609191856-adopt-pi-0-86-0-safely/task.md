Status: in_progress
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

Planning is complete in `plan.md`. Implementation is in progress. The operator explicitly accepted the low-stakes `pi-mcp-adapter@2.34.0` peer-range exception for this personal harness, with MCP validation retained.

## Outcome

Pending implementation, validation, and host self-update.
