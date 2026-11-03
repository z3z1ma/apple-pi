## file

The script imports the harness's detector directly from `components/repo-rules/src/comments.ts`, relying on Node's native type stripping (no register hook). Keep that module to erasable TypeScript syntax and keep the `engines.node` floor at a release that strips types by default.
Why: the lint script and the harness edit check must count the same comments; a second copy of the detector drifted once (it missed comments after punctuation), and a non-erasable construct in `comments.ts` would make `npm run lint` fail to load rather than report comments.

Coupled: components/repo-rules/src/comments.ts, package.json
Verify: components/repo-rules/tests/repo-rules.test.ts
