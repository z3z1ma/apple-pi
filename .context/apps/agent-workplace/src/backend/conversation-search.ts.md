## file

DM search reads transcripts directly with ripgrep instead of asking the runtime: it is read-only, on demand and local (2.5 GB of transcripts searched in about 0.1-0.6 s). Ripgrep only finds candidate lines; a hit is kept only when the parsed entry is a user or assistant message whose visible text matches, so tool output, thoughts and mail never count as something a person said. Without `rg` on the PATH it reports that, rather than an empty result.
Why: the runtime indexes only 120-character previews, and assistant previews are often empty; a second full-text store would duplicate the transcripts.
Coupled: apps/agent-workplace/src/backend/transcript.ts, apps/agent-workplace/web/workplace-switcher.tsx
Verify: apps/agent-workplace/tests/conversation-search.test.ts, apps/agent-workplace/tests/world-desk.test.ts
