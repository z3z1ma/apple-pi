Type: interrogation
Status: resolved
Blocked by: 01, 02, 03

# Shell and service runtime

## Question

Which desktop shell and which backend runtime does Agent World use?

Decide between Tauri v2, a Swift WKWebView shell, and a browser page, and between a Node/TypeScript service (the repository's language), a Rust service, or the backend living inside a Pi extension. Confirm the frontend stack (the handoff suggests React + PixiJS + Vite) and that one frontend serves both desktop and browser. Record as an ADR if approved.

Constraint from [Source of SaaS work data](07-source-of-saas-work-data.md): Slack sign-in happens in a browser whose session token and cookie the backend must capture. An embedded webview the app controls can do this; a plain browser tab cannot.

## Answer

Decided with the operator, 2026-10-18. Mac only for now.

- **Desktop shell: Electron.** One language (TypeScript) end to end; Chromium renders, which is the engine Phaser is tested against most; Slack sign-in runs in an Electron window whose session cookies (including HttpOnly) the app reads through Electron's session cookie API. Electron (about 100 MB on npm, larger on disk, roughly 150 to 300 MB of RAM) is installed on Agent World's first launch, not as an apple-pi dependency, so users who never open Agent World do not download it.
- **Backend: Node / TypeScript**, the repository's language. Browser mode later serves the same frontend from this backend.
- **Game engine: Phaser 4** (4.2.1 stable on npm, 2026-10-18), for scenes, Tiled maps, cameras, input, sprite animation, tweens, and collision. **React** draws dialogue, the inspector, and panels as HTML over the canvas, so dense text stays crisp and accessible. Vite builds the frontend into a committed bundle, as `components/browser-pages/` does, so Phaser and React stay build-time dependencies.
- **Browser mode:** the same frontend on `127.0.0.1`, as a later milestone; Slack sign-in only in the desktop app.
- **Rejected:** Tauri v2 (small and native, but Rust in the stack plus a first-run build or a prebuilt binary to publish; cookie API since 2.4); a Swift WKWebView shell (tiny, but every native feature hand-written); PixiJS v8 (a renderer only, so we would rebuild tilemaps, camera, input, and scenes); Godot (a native engine that cannot host the React panels in the same page).
- **ADR:** `docs/adr/0001-agent-world-runtime.md`.
- **Handed off:** whether the backend runs inside Electron's main process or as its own process, and what starts it, belongs to [Service lifetime](09-service-lifetime.md).
