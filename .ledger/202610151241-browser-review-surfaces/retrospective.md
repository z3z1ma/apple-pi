Status: pending
Created: 2026-10-15
Updated: 2026-10-15

# Retrospective

## What Mattered

Pending completion of the undertaking.

## Learnings

- The operator wants the main agent to design and build these pages itself. Bring in the designer teammate only later, for one-shot components inside a structure that is already laid out.
- Check page behavior on the element that matters, not on UI state. For nested horizontal scrolling, measure the real scroll container (`scrollWidth` against `clientWidth`, then set `scrollLeft`); a parent row can have no overflow while its inner strip overflows. After a jump, check that the target is in the viewport: a smooth scroll over thousands of pixels leaves it below the fold for a long time, so long jumps scroll at once (`web/app.tsx`, more than two viewports).
- Stress dense indicators, such as the coverage strip, with the real number of items. Constrain the strip's overflow and minimum widths, and keep its count outside the scroll container and unable to shrink.
- In a keyboard-driven page, a button next to a text field takes focus when clicked, and the next typed letters fire page shortcuts. Give such buttons `onMouseDown={(e) => e.preventDefault()}`. A Playwright drive found this; unit tests did not.

## Improvements

Pending completion of the undertaking.
