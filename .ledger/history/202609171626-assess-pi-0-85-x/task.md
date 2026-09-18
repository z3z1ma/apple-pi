Status: done
Created: 2026-09-17
Updated: 2026-09-17

# Assess Pi 0.85.x opportunities for Apple Pi

## Intent

Assess Pi 0.85.0–0.85.1, and unreleased main after 0.85.1, against Apple Pi's current extension surface. Identify concrete upgrades, deletions, migration risks, and YAGNI items from primary sources.

## Success Criteria

- Compare the official changelogs, extension docs, and 0.85.1 npm artifacts with the installed 0.84.4 package family.
- Map relevant changes to Apple Pi's custom editor/footer, terse-tools patches, bash override, pair `user_bash` hook, ledger/wiki/rtk `before_agent_start` prompts, compaction, and xAI surfaces.
- Validate that the current tree can typecheck and run the relevant suites against Pi 0.85.1 without committing an upgrade.
- Record a prioritized, evidence-backed recommendation. Treat unreleased main as a watchlist, not the install target.

## Current State

Research complete in `research.md`. A temporary 0.85.1 install passed typecheck, 1051 unit tests, 121 offline pair tests, and package loading. Pins were restored to 0.84.4. Interactive TUI smoke is still unverified.

## Outcome

Recommend upgrading the aligned Pi package family to 0.85.1, keeping the standalone working indicator and private footer bridge, proving terse-tools on the new host, and bumping `pi-mcp-adapter` to a 0.85-aware peer. Do not invent Apple Pi features from this changelog. Unreleased main is a watchlist only.
