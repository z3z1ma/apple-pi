## file

This loader lets Node run the package's TypeScript as-is. Imports name `./x.js` while the file is `./x.ts`.
Why: Node's type stripping resolves the runtime path, and a `.ts` import would not match the package's ESM convention.
Coupled: components/session-state/src/runtime-main.runtime.ts
Verify: components/session-state/tests/runtime.test.ts
