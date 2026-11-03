## file

Rules run on a temporary copy of the proposed content at `src/<basename>`, so a `.grit` rule cannot see the file's real path; path scoping comes only from the rule's `includes` in `.pi/rules/policy.json`.
Why: the check must run on content that is not yet on disk, without touching the repository.

`@biomejs/biome` and `typescript` are runtime `dependencies`, not dev dependencies.
Why: Pi installs git packages without dev dependencies, and this check runs inside every session.

In apple-pi the same rules also run in `npm run lint` through `biome.json` overrides, whose `includes` must match `policy.json`.
Coupled: package.json, biome.json, .pi/rules/policy.json
