## file

Bare index.html and ?workplace=<tab> enter the Workplace shell, including its retained World tab. The exact ?world route remains the standalone game entry for existing captures/tests; ?world&embedded=1 is the same packaged renderer inside WorkplaceWorld. Dynamic imports keep each document's Phaser/React roots and global CSS separate. The embedded route omits the old Workplace navigation link.

Before the embedded World imports any consumers, it verifies the parent's origin/path and expected frame title and reuses the parent's preloaded AgentWorldApi and reply-watch aggregate. Top-level entry creates that aggregate once; both documents' readers register against the same function rather than each replacing the native subscription independently. The AgentWorldApi functions retain their parent preload/IPC origin; the reply-watch aggregate is renderer coordination only. Electron's mainFrame guards stay unchanged. This is a trusted same-origin packaged frame, not an arbitrary subframe capability bridge.
Why: loading World and Workplace into the same document would create competing overlay roots/styles. Giving the child its own IPC authority would widen the native boundary; reusing the existing parent API preserves it and needs actual Electron validation.

Workplace sets body.workplace and its title only in the parent. The child retains the normal World document/canvas. Switching the World tab changes local shell state rather than navigating the main renderer, so draft and PTY cleanup belongs only to actual reload/navigation/closure.
Coupled: apps/agent-world/web/workplace-world.tsx, apps/agent-world/web/workplace.tsx, apps/agent-world/web/main.tsx, apps/agent-world/web/index.html, apps/agent-world/web/reply-watches.ts, apps/agent-world/src/electron/terminal-ipc.ts
Verify: apps/agent-world/tests/world-conversation.test.ts, apps/agent-world/tests/world-interface.test.ts, apps/agent-world/tests/world-terminal.test.ts, apps/agent-world/tests/world-navigation.test.ts
