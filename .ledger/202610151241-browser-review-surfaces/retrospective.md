Status: pending
Created: 2026-10-15
Updated: 2026-10-15

# Retrospective

## What Mattered

Pending completion of the undertaking.

## Learnings

- The operator wants the main agent to design and build these pages itself. Bring in the designer teammate only later, for one-shot components inside a structure that is already laid out.
- Each page gets its own design and approval pass. Pages share components, but the operator approves each page alone. Every page header shows the 🥧.
- For documents, the rendered Markdown comes first, and feedback means selecting text and annotating it from a toolbar (Plannotator-style). The operator rejected an agent-curated Markdown page (framing card, notes, decisions, read-tracking); keep agent input minimal and secondary.
- Check page behavior on the element that matters, not on UI state. For nested horizontal scrolling, measure the real scroll container (`scrollWidth` against `clientWidth`, then set `scrollLeft`); a parent row can have no overflow while its inner strip overflows. After a jump, check that the target is in the viewport: a smooth scroll over thousands of pixels leaves it below the fold for a long time, so long jumps scroll at once (`web/app.tsx`, more than two viewports).
- Stress dense indicators, such as the coverage strip, with the real number of items. Constrain the strip's overflow and minimum widths, and keep its count outside the scroll container and unable to shrink. Grid and flex children default to `min-width: auto`; give them `min-width: 0` and `minmax(0, 1fr)`, and measure overflow in the browser instead of guessing.
- React can run a `setState` updater later, during render. Create ids and derived values outside the updater and pass them in; the Markdown page's ask never fired until this changed.
- Assert on a saved page's parsed `<script id="page-data">` JSON, not on its HTML. Shiki splits text into tokens, and a failed `toContain` prints the whole page (about 370 KB).
- In a keyboard-driven page, a button next to a text field takes focus when clicked, and the next typed letters fire page shortcuts. Give such buttons `onMouseDown={(e) => e.preventDefault()}`. A Playwright drive found this; unit tests did not.

## Improvements

Pending completion of the undertaking.
