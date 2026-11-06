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
- `@vitest-environment`;
- triple-slash references and shebangs;
- bundler annotations: `@vite-ignore`, `#__PURE__`, `@__PURE__`, `webpackIgnore`.

Run it with `node lint/no-comments.mjs [paths...]`. With no paths it checks every tracked source file. It uses the
harness's detector (`components/repo-rules/src/comments.ts`), so it reports exactly what an edit would be refused for. It joins
`npm run lint` once the migration of existing comments reaches zero (ledger task `202611022254-mechanize-judgment`).

## Rules

apple-pi opts in to the harness's rules (`components/repo-rules`) with `.pi/rules/`. The harness checks every tool
call and edit against them before it runs; `npm run lint` runs the same GritQL rules and edit scripts over every
tracked file they apply to, through the same engines (`lint/repo-rules.mjs`).

- `policy.json`: `"comments": "forbid"`, the GritQL rules with the paths they apply to, the action rules and the script rules, each with `fires` and `passes` samples (see `docs/repo-rules.md`).
- `parallel-dependents.js`: refuses a read or shell command that names a file a sibling call in the same message
  edits, and both of two writes to one file; parallel calls run concurrently.
- `commit-beside-edit.js`: refuses `git add` or `git commit` in a message that also edits files.
- `no-native-select.grit`: Workplace uses `Select` and `Recipients`, not native dropdowns.
- `workplace-palette.grit`: Workplace stylesheets take colors from `--wp-*` theme variables; white and black overlays
  are allowed. `workplace.css` is excluded because it defines the house palette itself.

Writing GritQL: regex capture groups bind variables and fail to compile, so use `(?:...)`. Matching a node by regex
works (`$v where { $v <: r"..." }`).
