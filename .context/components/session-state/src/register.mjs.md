## file

When a relative import ending in `.js` fails to resolve, this hook retries the same specifier with `.ts`.
Why: the package imports `.js` (the ESM path) while the file on disk is `.ts`. Node's type stripping does not rewrite that specifier.

When a bare specifier cannot be found and `PI_HOST_PACKAGE_DIR` is set, the hook resolves it again as if imported from the Pi package that launched us.
Why: Pi installs packages with `--omit=peer`, because its extension loader supplies Pi's libraries (`@earendil-works/*`, `typebox`) in process. Separate processes the package starts (the runtime, Workplace's Electron) have no such loader, so in an installed package those imports fail. Every spawner sets the variable from `getPackageDir()`; a development checkout resolves them from its own `node_modules` and never reaches the fallback.

Coupled: components/session-state/src/runtime-main.runtime.ts, components/session-state/src/client.ts, apps/agent-workplace/src/launch.ts, apps/agent-workplace/src/electron/start.mjs
Verify: components/session-state/tests/singleton.test.ts, apps/agent-workplace/tests/installed-package.test.ts
