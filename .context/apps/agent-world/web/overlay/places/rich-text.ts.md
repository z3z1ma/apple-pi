## file

The only way Jira's and Confluence's HTML reaches the page: parsed by `DOMParser` (an inert document: no script runs, nothing loads) and rebuilt element by element from an allow-list into a second document, so nothing unlisted (attributes, `style`, handlers, `class`) survives; the result is then set as `innerHTML`. Adding a tag to `KEEP` keeps none of its attributes unless `copy` adds them; images are never loaded (they need the operator's Atlassian session and would tell the site the page was read), only named. Links keep `http(s)` and `mailto` only, resolved against the signed-in site, and `rich-view.tsx` opens them through the main process.
Why: tickets 24-26 and the integrations API (`src/integrations.ts`: "untrusted HTML: sanitise before showing").
Coupled: apps/agent-world/web/overlay/places/rich-view.tsx
Verify: apps/agent-world/tests/world-quest-library.test.ts
