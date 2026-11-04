Status: planning
Created: 2026-11-03
Updated: 2026-11-03

# A custom system prompt for the harness

## Intent

The operator wants apple-pi to own its system prompt completely, as the next step toward the strongest harness. Step one, done: understand the current prompt. The Pi base, every section apple-pi and Pi's MCP add, and every tool definition are captured from a real request and rendered in [current-prompt/](current-prompt/README.md). Next: decide what the custom prompt should be. Acceptance criteria are settled once the operator has read the capture.

## Current State

- [current-prompt/README.md](current-prompt/README.md): sizes, who writes each section, what varies between sessions and providers, and how to capture again.
- `system-prompt.md` and `tools.md` hold the full text; `system-prompt.txt` holds the exact bytes.
- Roughly 34k tokens of system prompt and 29k tokens of tool definitions per request. The largest parts are `project_context` (the two `AGENTS.md` files, about 12.6k), `project-learnings` (about 7.4k), `rules` (about 3.9k) and `skills` (about 3.6k).
- Pi already lets an extension replace the preamble, any single section, or the whole prompt (see the README).

## Outcome

Pending shaping.
