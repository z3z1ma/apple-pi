## file

Open pages are listed per session in one file, keyed by tool call, with the owning process id. A reader ignores the file when that process has exited.
Why: Agent Workplace runs in another process and only knows a DM's session id and the tool call ids in its transcript. A sign-off's address otherwise exists only in a streaming update, which the transcript does not keep. The pid check covers a session that died without closing its pages.

Each entry is written when the page server opens and removed when it closes: in `finally` for sign-offs, and at session shutdown for explanations.

Agent Workplace's main process writes `agent-workplace/focus.json` with its pid while its window has focus, and deletes it on blur, close and quit. While that file names a live process, the page tools skip the system browser: the operator opens the page from the card in the DM instead (operator request, 2026-11-03). The tool's message says so.
Why: opening the system browser while he works in Workplace pulls focus away to a page he can already open inline.
Coupled: components/browser-pages/src/index.ts, apps/agent-workplace/src/electron/main.ts, apps/agent-workplace/web/overlay/conversation/conversation-panel.tsx
Verify: components/browser-pages/tests/live-pages.test.ts, components/browser-pages/tests/code-review.test.ts
