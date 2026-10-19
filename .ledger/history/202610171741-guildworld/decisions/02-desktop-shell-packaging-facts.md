Type: research
Status: resolved
Blocked by: 

# Desktop shell packaging facts

## Question

What does each candidate desktop shell cost to build, ship, and run from this repository on macOS?

Candidates: Tauri v2 (with a sidecar or a separate local service), a Swift WKWebView shell compiled on first run (the notch precedent in `components/tmux-sessions/scripts/notch.sh`), and a plain browser page served by a local process. For each: required toolchain on the user's machine (Pi installs git packages without dev dependencies), build time and size, signing and Gatekeeper behaviour for an unsigned local build, WebGL/PixiJS support in the webview, how the page talks to a local backend, and process lifecycle (window close vs backend).

## Answer

Findings: [desktop shell packaging](../research/desktop-shell-packaging.md).

- Tauri v2 needs Xcode CLT + Rust + Node to build. Pi installs without dev dependencies, so a shipped Tauri app means either a Rust build on the user's machine at first run or a prebuilt committed or downloaded binary with signing questions. Its WKWebView is the same engine as the notch's.
- A Swift WKWebView shell needs only `swiftc`, which the notch already requires, and builds on first run as the notch does. A local build carries no quarantine flag.
- A browser page served by a local Node process needs no native toolchain and reuses the browser-pages pattern.
- Not verified: Tauri sidecar fate on app exit, Tauri cold-build time, and PixiJS v8 under WKWebView specifically.
