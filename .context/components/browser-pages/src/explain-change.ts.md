## symbol:tutorPrompt

The prompt tells the tutor to point to "Step N", "Figure N", or "Question N", and the page turns exactly those words into links (`tutorHtml` in `web/explain/chat.tsx`). Change the wording on one side and the other must follow.
Why: citations are the tutor's way back into the explanation; a model that writes "the second step" produces text the page cannot link.

Coupled: components/browser-pages/web/explain/chat.tsx
Verify: components/browser-pages/tests/explain-change.test.ts

## symbol:excerpts

`code path:FROM-TO` counts lines of the file after the change, except for a file the change deletes, which has only its old lines. The tool's guideline in `index.ts` and `docs/browser-pages.md` state the same rule.
Why: a changeset can delete files, and the agent needs a way to show what left; without the base side, those references could only fail.

Coupled: components/browser-pages/src/index.ts, docs/browser-pages.md
Verify: components/browser-pages/tests/explain-change.test.ts
