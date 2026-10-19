Type: interrogation
Status: resolved
Blocked by: 02

# Where Agent World lives and ships

## Question

Where does Agent World live inside apple-pi, and does it ship in the Pi package?

Options include a `components/guildworld/` domain like `tmux-sessions` (shipped, built on first run like the notch), a repository-only app directory outside the published `files`, or a separate package in the same repository. Decide the directory, whether `package.json` publishes it, how a user starts it, and how the "one installable Pi package" boundary in `AGENTS.md` changes, if at all.

## Answer

Decided with the operator, 2026-10-17.

- **Name:** the product is **Agent World** in prose and `agent-world` in code and paths (operator, 2026-10-18). It replaced Pomona once the operator dropped the apple theme: names in the system say what a thing is, and fun belongs on the edges. "Guildworld" in the handoff is the first retired working name. In-world names stay per theme.
- **Directory:** top-level `apps/agent-world/`, holding backend source, frontend source, the committed built frontend, and themes. The new `apps/` area must be added to `package.json` `files`, `tsconfig.json`, `vitest.config.ts`, and the Biome lint and format paths.
- **Shipping:** the published package carries the source, the built frontend committed like `components/browser-pages/dist/`, and cleaned theme art. Raw art and generation inputs stay in the repository only, as `components/tmux-sessions/notch/art/` does.
- **Package boundary:** unchanged. One package, no workspaces, no second `package.json`; `AGENTS.md` gains one architecture-map row for `apps/`.
- **Handed off:** what starts Agent World and how long it runs ([Service lifetime](09-service-lifetime.md)); the shell, the backend runtime, and any first-run native build ([Shell and service runtime](08-shell-and-service-runtime.md)).
