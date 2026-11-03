## file

This is the one comment detector. The harness's edit gate and `lint/no-comments.mjs` both use it, and the script imports this `.ts` file directly through Node's built-in type stripping (engine >=22.19). Keep the file to erasable TypeScript syntax: no enums and no parameter properties.
Why: two copies of the detector had drifted, so the lint script and the edit gate disagreed on what counts as a comment.

## symbol:allComments

The walk visits every token through `getChildren`, punctuation included, not only `forEachChild` nodes. The visit is what finds `}, // note` after a comma, comments between union members, and `{/* note */}` inside JSX. JSX text such as `http://x` is not a comment.
Why: walking only `forEachChild` nodes missed comments that follow punctuation tokens, and lanes reported directories as clean that were not.

Coupled: lint/no-comments.mjs, lint/README.md
Verify: components/repo-rules/tests/repo-rules.test.ts
