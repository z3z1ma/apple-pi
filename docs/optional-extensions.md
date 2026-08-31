# Optional extensions

The default harness does not load the retained session backlog or to-do checklist. Their complete supported implementations remain packaged under `optional-extensions/` for installations that want those model tools and TUI managers.

To activate one explicitly, add its entrypoint to the Pi extension configuration for the installed package:

- `optional-extensions/backlog/index.ts`
- `optional-extensions/todos/index.ts`

They are intentionally opt-in and are covered by the normal TypeScript, formatting/lint, and Vitest checks. See [backlog](backlog.md) and [to-dos](todos.md) for their unchanged contracts.
