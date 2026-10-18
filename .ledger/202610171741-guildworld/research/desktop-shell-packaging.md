# Desktop shell packaging facts

Research for [Desktop shell packaging facts](../decisions/02-desktop-shell-packaging-facts.md). Gathered 2026-10-17.

## Constraint from this repository

- Pi installs git packages without dev dependencies (`AGENTS.md`, package and extension loading). Anything not committed or built on the user's machine at first run is absent.
- Precedent: the notch panel ships only `NotchShell.swift` and its web page; `components/tmux-sessions/scripts/notch.sh` compiles it with `swiftc -O` into `~/.pi/agent/cache/notch/pi-notch-<hash>` on first start, logs to `~/.pi/agent/logs/pi-notch.log`, and starts nothing when `swiftc` is missing (`notch.sh` lines 18–28; `docs/tmux-sessions.md`, "Requirements and start-up").
- Precedent: browser pages are React pages built into committed single files in `components/browser-pages/dist/` because Pi installs without dev dependencies (`AGENTS.md`).

## Tauri v2

- Building needs Xcode or the Xcode Command Line Tools, plus Rust via rustup ([prerequisites](https://raw.githubusercontent.com/tauri-apps/tauri-docs/v2/src/content/docs/start/prerequisites.mdx), "macOS" and "Rust"). Node is needed for the frontend build.
- End users of a built app do not need Rust; the app is a native binary using the OS webview, so minimal apps are small ([v2.tauri.app](https://v2.tauri.app/start/)).
- On macOS the webview is WKWebView ([webview versions](https://v2.tauri.app/reference/webview-versions/)).
- A sidecar is an external binary listed in `bundle.externalBin`, one per target triple (`<name>-aarch64-apple-darwin`), and spawned through the shell plugin with capability-scoped arguments ([sidecar](https://raw.githubusercontent.com/tauri-apps/tauri-docs/v2/src/content/docs/develop/sidecar.mdx)). The sidecar page does not state what happens to a spawned sidecar when the app exits. **Not verified.**
- The core process is Rust and is the only part with full OS access; IPC routes through it ([process model](https://raw.githubusercontent.com/tauri-apps/tauri-docs/v2/src/content/docs/concept/process-model.md)).
- The localhost plugin, which serves app assets over `http://localhost:<port>`, "brings considerable security risks"; the default is the custom protocol ([localhost plugin](https://raw.githubusercontent.com/tauri-apps/tauri-docs/v2/src/content/docs/plugin/localhost.mdx)).
- Distribution outside the App Store needs signing and notarization; an ad-hoc identity avoids blocks for local or unsigned builds ([macOS signing](https://v2.tauri.app/distribute/sign/macos/)).
- Cold build time and on-disk size of the Rust build cache for a Tauri app on this machine: **not measured.**

## Swift WKWebView shell (notch precedent)

- Needs only the Xcode Command Line Tools (`swiftc`), which the notch already requires.
- A binary built locally has no `com.apple.quarantine` attribute, so Gatekeeper's download checks do not apply ([Apple: Gatekeeper and runtime protection](https://support.apple.com/guide/security/gatekeeper-and-runtime-protection-sec5599b66df/web)). Apple Silicon requires a code signature on arm64 executables; an ad-hoc signature, which the local toolchain applies, satisfies it (secondary sources; **not verified** against Apple documentation).
- WKWebView on current macOS supports WebGL2; WebGPU ships in Safari/WebKit on recent macOS (secondary summary; **not verified** for PixiJS v8 in WKWebView specifically). This machine runs macOS 26.7.

## Browser page served by a local process

- No native toolchain. The repository already serves token-protected pages on 127.0.0.1 from Node (`components/browser-pages/`), so the pattern and its security posture exist in-house. Details are in the [apple-pi integration inventory](apple-pi-integration-inventory.md).
- A browser tab has no window lifecycle tied to the backend; the backend's lifetime is independent by construction.

## This machine

`rustc` 1.96.1, `cargo`, `swiftc`, `node`, and `uv` are all present. Another user's machine may lack Rust; `docs/setup.md` does not list it.
