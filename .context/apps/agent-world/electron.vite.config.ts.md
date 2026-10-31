## file

Keep @lydell/node-pty external alongside Electron and Node builtins. The native addon and its platform package resolve from the installed apple-pi runtime dependency; bundling its JavaScript into main would break its relative native-package loading. Ghostty is different: its browser JS/WASM is built into renderer assets from a dev dependency.
Bundled review configuration and browser pages locate the packaged role catalog, templates and Mermaid beside their original source modules. Rebase those consumers' import.meta.url relative to dist/electron, retaining package-relative rather than build-machine absolute paths. A moved role URL made Electron preview and runtime admission disagree on the captured configuration digest; source-only backend tests did not expose it.
Coupled: package.json, apps/agent-world/src/backend/embedded-terminal.ts, apps/agent-world/web/workplace-terminal.tsx
Verify: apps/agent-world/tests/build.test.ts
