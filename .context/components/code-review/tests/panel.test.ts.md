## file

These component checks use a fake terminal, not an actual interactive Pi process. The loaded-command test in review-queue.test.ts supplies the real reader and isolated runtime, including one-row pages so selection must follow identity through reorder. Neither establishes a live terminal screenshot or production activation.

truncateToWidth can append an ANSI reset even with plainTheme. Strip generated VT sequences before asserting that physical rows contain no raw C0 controls; measure width and row count on the actual rendered strings. Evidence includes long text, newlines and control characters rather than only short fixture labels.

Capture confirmation tests keep the heading and consent row visible at each supported width and scroll through long evidence. A terminal too small to show the consent controls cannot accept y. Prose wraps: normalize whitespace for meaning assertions in the loaded-command test, while physical width/row/control assertions keep the actual rendered strings.

Coupled: components/code-review/src/panel.ts, components/code-review/src/review-manager.ts
Verify: components/code-review/tests/panel.test.ts, components/session-state/tests/review-queue.test.ts
