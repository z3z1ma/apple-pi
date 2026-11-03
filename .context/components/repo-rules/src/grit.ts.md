## file

Rules run on a temporary copy of the proposed content at `src/<basename>`, so a `.grit` rule cannot see the file's real path; path scoping comes only from the rule's `includes` in `.pi/rules/policy.json`.
Why: the check must run on content that is not yet on disk, without touching the repository. `biome lint --stdin-file-path` does not help: it printed only the formatter's output and no plugin diagnostics. The copy sits beside a temporary `biome.json` that lists the absolute `.grit` paths, and `biome lint src/<name> --reporter=json` runs with that directory as cwd.

A rule that fails to compile prints no JSON, and a rule with a bad regex reports only an info diagnostic `X errored` when the regex matches a node; otherwise a broken rule silently never fires. Both count as rule failures, and `checks.ts` requires a `fires` sample for every rule.
Coupled: components/repo-rules/src/checks.ts

`@biomejs/biome` and `typescript` are runtime `dependencies`, not dev dependencies.
Why: Pi installs git packages without dev dependencies, and this check runs inside every session.

In apple-pi the same rules also run in `npm run lint` through `biome.json` overrides, whose `includes` must match `policy.json`.
Coupled: package.json, biome.json, .pi/rules/policy.json
