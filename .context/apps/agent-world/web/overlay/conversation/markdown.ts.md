## file

Raw HTML renders as escaped text, http(s) links as `<a class="aw-md-link">` with no `target`, every other link as a dotted span titled with its target, and images as their alt text; the result goes into `dangerouslySetInnerHTML`.
Why: transcripts are untrusted (tool output, web pages the agent read); the window must never run script, navigate, or load remote content (its CSP allows only `self` and `data:`). A link opens only through the transcript's click handler, which prevents the default and asks the main process (`openLink`); the main process checks the URL again (`src/backend/links.ts`) before `shell.openExternal`.
Coupled: apps/agent-world/web/index.html, apps/agent-world/web/overlay/conversation/transcript.tsx, apps/agent-world/src/backend/links.ts
Verify: apps/agent-world/tests/world-conversation.test.ts, apps/agent-world/tests/links.test.ts
