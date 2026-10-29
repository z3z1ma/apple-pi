## file

This module is the single Monaco worker environment for Workplace. Import it only through the Code view's dynamic import. The retained Code component owns its workers; terminate them after disposing its editor and models on actual unmount, while application-tab hiding retains them.
Why: Monaco's environment is renderer-global. Terminating workers when Code is hidden leaves retained model language services pointing at stopped workers; importing this module in the shell would also load the editor before Code is visited.

Import workers through Monaco's published package subpaths, such as `monaco-editor/editor/editor.worker.js?worker` and `monaco-editor/language/typescript/ts.worker.js?worker`. Check the dependency's exports map when upgrading and run `npm run build:world` after changing these imports.
Why: Monaco 0.57 maps package subpaths into `esm/vs`; including that disk prefix in an import makes Vite resolution fail even when the worker file exists. Typechecking alone did not catch this build failure.

Coupled: apps/agent-world/web/workplace-code.tsx, apps/agent-world/web/vite.config.ts, package.json
Verify: apps/agent-world/tests/world-code.test.ts, apps/agent-world/tests/build.test.ts
