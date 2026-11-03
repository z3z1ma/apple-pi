## file

`main` is ESM and `preload` is CommonJS, because a sandboxed preload must be CommonJS. Both outputs are committed under `dist/electron`, with imports bundled except Electron and Node. `emptyOutDir` runs only for `main`, which builds first; a preload build must not wipe it.
Why: building preload first, or as ESM, produces a preload Electron will not load or a dist that no longer contains main.

Keep @lydell/node-pty external alongside Electron and Node builtins. The native addon and its platform package resolve from the installed apple-pi runtime dependency; bundling its JavaScript into main would break its relative native-package loading. Ghostty is different: its browser JS/WASM is built into renderer assets from a dev dependency.
Bundled review configuration and browser pages locate the packaged role catalog, templates and Mermaid beside their original source modules. Rebase those consumers' import.meta.url relative to dist/electron, retaining package-relative rather than build-machine absolute paths. A moved role URL made Electron preview and runtime admission disagree on the captured configuration digest; source-only backend tests did not expose it.
Coupled: package.json, apps/agent-workplace/src/backend/embedded-terminal.ts, apps/agent-workplace/web/workplace-terminal.tsx
Verify: apps/agent-workplace/tests/build.test.ts
