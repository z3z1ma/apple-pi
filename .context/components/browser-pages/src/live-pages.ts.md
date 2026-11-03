## file

Open pages are listed per session in one file, keyed by tool call, with the owning process id. A reader ignores the file when that process has exited.
Why: Agent Workplace runs in another process and only knows a DM's session id and the tool call ids in its transcript. A sign-off's address otherwise exists only in a streaming update, which the transcript does not keep. The pid check covers a session that died without closing its pages.

Each entry is written when the page server opens and removed when it closes: in `finally` for sign-offs, and at session shutdown for explanations.
Coupled: components/browser-pages/src/index.ts, apps/agent-workplace/src/electron/main.ts, apps/agent-workplace/web/overlay/conversation/conversation-panel.tsx
Verify: components/browser-pages/tests/live-pages.test.ts
