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

Run it with `node lint/no-comments.mjs [paths...]`. With no paths it checks every tracked source file. It joins
`npm run lint` once the migration of existing comments reaches zero (ledger task `202611022254-mechanize-judgment`).

## Rules

apple-pi opts in to the harness's repository rules (`components/repo-rules`) with `.pi/rules/`. The harness checks
every `edit` and `write` against them before the change lands, and every shell command against the action rules;
`npm run lint` runs the same GritQL rules through `biome.json` overrides.

- `policy.json`: `"comments": "forbid"`, the GritQL rules with the paths they apply to, and the action rules.
- `no-native-select.grit`: Workplace uses `Select` and `Recipients`, not native dropdowns.
- `workplace-palette.grit`: Workplace stylesheets take colors from `--wp-*` theme variables; white and black overlays
  are allowed. `workplace.css` is excluded because it defines the house palette itself.

Writing GritQL: regex capture groups bind variables and fail to compile, so use `(?:...)`. Matching a node by regex
works (`$v where { $v <: r"..." }`).
