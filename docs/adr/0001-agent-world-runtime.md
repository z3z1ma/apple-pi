# Agent World runs on Electron, a Node backend, and Phaser 4

Agent World is a full-screen world app over tmux and Pi, Mac only for now. It runs as an Electron app with a Node/TypeScript backend; Phaser 4 draws the world, and React draws dialogue, the inspector, and panels over the canvas. We chose one language end to end, Chromium as the rendering target Phaser is tested against most, and Electron's session cookie API for capturing a Slack browser sign-in, over the footprint of a native shell. Electron is installed on Agent World's first launch, not as an apple-pi dependency, so users who never open Agent World do not download it.

## Considered options

- **Tauri v2:** small and native on WKWebView, but it puts Rust in the stack and needs a first-run Rust build or a published prebuilt binary, because Pi installs packages without dev dependencies.
- **Swift WKWebView shell:** tiny and built with `swiftc` alone, but every native feature (windows, menus, sign-in window, IPC) would be hand-written in Swift.
- **PixiJS v8:** a fast renderer only; tilemaps, camera, input, scenes, and collision would all be ours to build.
- **Godot:** a native engine that cannot host the React panels in the same page.

## Consequences

- Phaser and React are build-time dependencies: Vite builds the frontend into a committed bundle, as `components/browser-pages/` does.
- A later browser mode serves the same frontend from the Node backend on `127.0.0.1`; Slack sign-in stays desktop-only.

Decision record: ledger task `202610171741-guildworld`, ticket "Shell and service runtime".
