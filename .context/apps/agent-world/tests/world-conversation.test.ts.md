## file

These browser checks load built Agent World assets and replace the preload API with an in-memory bridge. Build after production-source edits; keep replies in the fixture's returned history so a successful post must become visible through the real reader. Channel membership tests here check the UI's command choices and response handling; the runtime and backend suites own authorization, persistence, read cursors, and crash recovery.
Why: a fixture that accepts a command without updating its next read can falsely report a lost message. Conversely, a permissive browser fixture cannot prove runtime permission or delivery behavior.
Coupled: apps/agent-world/web/workplace.tsx, apps/agent-world/web/overlay/conversation/transcript.tsx, apps/agent-world/tests/channel-membership.test.ts, components/session-state/tests/channel-membership.test.ts
Verify: apps/agent-world/tests/build.test.ts

Text-only transcripts retain identity controls. Check the absence of diagnostic folds and historical detail, rather than a global zero-button count that would prohibit avatar/profile navigation. Profile opening reads snapshot facts plus on-demand Self, without history/seen effects; entering the DM performs the ordinary conversation reads. The fixture returns the pre-read channel cursor, advances it after a participant read or own post, and publishes matching unread summaries. Global sequence gaps and own posts exercise the boundary rather than a guessed count-derived cursor. Test focus after replacing an open profile as well as closing its first instance.
Coupled: apps/agent-world/web/workplace-people.tsx

The unread regression holds a newest-page response while a previously loaded DM receives a newer run-state snapshot, then releases it. Its visual check constrains a small round indicator relative to the name line, rather than requiring a particular pixel diameter. Contrast checks measure readability on the rendered surface rather than requiring a border. Profile checks verify each field's visible content and independent expansion instead of counting all regions in the panel.
Why: immediate response fixtures can pass even if the old page incorrectly acknowledges the new update. Fixed CSS values and unrelated region counts would instead reject valid presentation changes. Mail navigation is checked separately by selecting Activity and reading its heading; checking only the button missed the stale Organization traffic heading.
Coupled: apps/agent-world/web/overlay/conversation/history.ts, apps/agent-world/web/overlay/conversation/conversation-panel.tsx, apps/agent-world/web/workplace.css

Assert escaped HTML as visible literal text and image Markdown as the probe's alt text, with no active image or unsafe link for that probe. Match the literal tag substring rather than requiring an element containing only that text; the parser can emit it as a bare text node among other Markdown children. Keep unrelated decorative images outside that restriction.
Why: a script inserted through innerHTML is already inert, so an unset execution marker alone would pass even if escaping broke. A global count of zero images would instead constrain avatar design, which the Markdown safety contract does not govern.
Coupled: apps/agent-world/web/overlay/conversation/markdown.ts, apps/agent-world/scripts/workplace-smoke.mjs
Verify: apps/agent-world/tests/world-conversation.test.ts
