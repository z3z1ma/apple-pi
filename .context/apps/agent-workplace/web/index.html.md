## file

The CSP's `frame-src http://127.0.0.1:*` is what lets a person's browser page (sign-off, explanation) render inline in their DM.
Why: `default-src 'self'` covers frames too, so without an explicit `frame-src` every loopback page iframe stays blank in the real app.
Coupled: apps/agent-workplace/src/electron/main.ts, apps/agent-workplace/web/overlay/conversation/conversation-panel.tsx
Verify: apps/agent-workplace/tests/world-conversation.test.ts
