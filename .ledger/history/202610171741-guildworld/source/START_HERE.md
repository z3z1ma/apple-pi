# Guildworld — Handoff Bundle

Read **`IMPLEMENTATION_HANDOFF.md`** first. It is the authoritative implementation-oriented vision document for a **new** app. Treat confirmed product decisions as constraints, suggested technologies and milestones as defaults to validate, and explicitly marked open questions as subjects for architecture decisions.

`references/approved-storybook-concept.png` is the moodboard the product owner endorsed as the general art direction. It is **not** a literal UI specification or a production asset.

## Suggested first instruction to your coding agent

> Implement the Guildworld vision in `IMPLEMENTATION_HANDOFF.md` incrementally. Start by verifying current `apple-pi` contracts, proposing a concise technical plan and ADRs, and building a standalone Tauri + shared-web world prototype with a mock event source and one charming Guild Hall. Keep the existing `apple-pi` notch UI absolutely untouched. Use the handoff’s acceptance criteria; distinguish demonstrated behavior from mock behavior. Pause for review of the first polished room and theme system before expanding.
