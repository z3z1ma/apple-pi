## file

When a relative import ending in `.js` fails to resolve, this hook retries the same specifier with `.ts`.
Why: the package imports `.js` (the ESM path) while the file on disk is `.ts`. Node's type stripping does not rewrite that specifier.
Coupled: components/session-state/src/runtime-main.runtime.ts
Verify: components/session-state/tests/singleton.test.ts
