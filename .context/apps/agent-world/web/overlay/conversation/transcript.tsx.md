## symbol:Markdown

The same escaped Markdown renderer serves session replies and team-channel messages. Channels supply a link callback that prevents navigation and delegates to the main process; session replies keep the transcript's existing outer click handler. Reuse includes that surrounding event boundary: ordinary clicks, keyboard activation, and middle-clicks must reach the bridge without navigating the window. Raw tags and remote images remain inert, and relative files use only the author's known directory, never a different participant's.
Why: a runtime channel is untrusted content just like a transcript. Sharing rendering must preserve the window's navigation and remote-content boundary.
Coupled: apps/agent-world/web/workplace.tsx, apps/agent-world/web/overlay/conversation/markdown.ts
Verify: apps/agent-world/tests/world-conversation.test.ts

## symbol:Author

The optional author renderer belongs to the embedding surface: workplace supplies real avatar/name controls mapped to its known session ID or operator; World retains its original author labels. Transcript entries do not carry an independent trustworthy agent identity, so names in historical mail text are not resolved to a session by display name. Keep this separate from the Markdown/link event boundary.
Coupled: apps/agent-world/web/workplace.tsx, apps/agent-world/web/workplace-people.tsx
Verify: apps/agent-world/tests/world-conversation.test.ts

## symbol:blocksOf

A tool result is drawn inside its call's folded line, found by `callId` across every loaded page; a result whose call is on a page not loaded yet stands alone as a folded "result" line until that page arrives.
Why: pages split turns anywhere, and the newest page is often a run of results whose calls are older.
Verify: apps/agent-world/tests/world-conversation.test.ts

## symbol:blockVisible

The operator's text-only contract supersedes the earlier forced-warning design: with details off, render only nonblank user text and assistant text parts. Thoughts, mail, notes, tool calls/results (including failures), historical reply errors/stops, and image-only metadata stay hidden, with no empty author rows or tool-only placeholder. Details on restores them; World defaults to details on. Keep all loaded entries and the full result index in either view.
Why: the switch is a clean conversation view, not a history mutation. Filtering stored entries would break tool/result association across pages and streamed-to-stored replacement; injecting diagnostic substitutes into the text view would violate the operator's explicit request.
Coupled: apps/agent-world/web/overlay/conversation/conversation-panel.tsx
Verify: apps/agent-world/tests/world-conversation.test.ts
