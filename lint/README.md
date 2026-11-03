# Lint rules

Lessons become rules here, not prose. When a review, a reflection or a failure finds a mistake a machine can detect,
the fix includes a rule in this directory, and the prose learning it replaces is retired.

## No comments (`no-comments.mjs`)

Source code holds no comments (operator decision, 2026-11-03). What a comment would say goes elsewhere:

- What the code does: a better name, or a smaller function with a name.
- Why it is this way, invariants, hazards and couplings: `.context/<path>.md`, in a `## file` or `## symbol:<name>`
  section with a `Why:` line (see `docs/code-context.md`). The context gate shows it to any agent that reads the file.
- How it behaves: a test.
- History and narration of a change: nothing; git holds it.

Tool directives are not comments and stay:

- `biome-ignore`;
- `@ts-expect-error`, `@ts-ignore`, `@ts-nocheck`;
- triple-slash references and shebangs;
- bundler annotations: `@vite-ignore`, `#__PURE__`, `@__PURE__`, `webpackIgnore`.

Run it with `node lint/no-comments.mjs [paths...]`. With no paths it checks every tracked source file; `npm run lint`
runs it too.
