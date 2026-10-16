# Frontend stack and build

Status: approved by the operator on 2026-10-15, who allows any packages the work needs.

## Constraint found

Pi installs a git package with `npm install --omit=dev --legacy-peer-deps` (Pi's `dist/core/package-manager.js`, `getGitDependencyInstallArgs`). Dev dependencies such as Vite are therefore absent on `pi install git:…`, so the package cannot build the page at install time. The built page must be committed. A checkout install (`npm install`, `pi install "$PWD"`) has the dev dependencies, but it must behave the same.

## Choices

| Concern | Choice | Reason |
| --- | --- | --- |
| UI framework | React 19 (TSX) | Most familiar, largest ecosystem for the later pages (graph layout, motion). Biome, `tsc`, and Vitest already handle TSX. |
| Bundler | Vite 8 + `vite-plugin-singlefile` (dev dependencies) | One HTML file with JS and CSS inline. The same file serves the live page and the saved page. |
| Build output | Committed, single file | Git installs omit dev dependencies. A validation step rebuilds and fails on `git diff`. |
| Styling | Plain CSS with custom-property tokens (the prototype's tokens) | No styling dependency; full control of the visual language. |
| Syntax highlighting | Shiki on the Node side (runtime dependency) | The server reads code from git and sends highlighted tokens. The browser bundle carries no grammars, and a saved page stays offline. |
| Diff | The server parses `git diff` output; word-level marks from the `diff` package or a small prefix/suffix pass | The prototype's renderer is about 100 lines; `@pierre/diffs` (Apache-2.0, React, Shiki) stays an option if our renderer falls short. |
| Server | `node:http` on 127.0.0.1, token in the URL, server-sent events to stream in-page "ask about this" answers | No WebSocket dependency. |

## Repository fit

- Owner: one new component (working name `components/web-ui/`): `src/` holds the server and tool wiring, `web/` holds the TSX app, `dist/` holds the committed build.
- `tsconfig.json` covers only `.ts`; the app gets its own `tsconfig.web.json` (DOM, `jsx: react-jsx`, bundler resolution), and `npm run typecheck` runs both.
- `package.json`: add `build:web`; add `src/` and the built file to `files`; add the extension entry; add Shiki to `dependencies`.
- Tests: Vitest for the server, payload validation (every hunk is placed once or is unplaced), and the result contract; Playwright screenshots against system Chrome for visual checks (as used for the prototype).
