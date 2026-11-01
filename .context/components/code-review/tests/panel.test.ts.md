## file

These component checks use a fake terminal, not an actual interactive Pi process. The loaded-command test in review-queue.test.ts supplies the real reader and isolated runtime, including one-row pages so selection must follow identity through reorder. Neither establishes a live terminal screenshot or production activation. The visual-pass task evidence separately records the installed Pi command in an isolated tmux terminal.

truncateToWidth can append an ANSI reset even with plainTheme. Strip generated VT sequences before asserting that physical rows contain no raw C0 controls; measure width and row count on the actual rendered strings. Evidence includes long text, newlines and control characters rather than only short fixture labels. The ANSI-preserving theme fixture verifies full frame widths and semantic color choices; the older shared plainTheme deliberately changes selected text and is unsuitable for exact-width assertions. Viewport paging expectations follow the requested page size, not the discarded borderless layout. Mouse checks include both content rows and pane headings.

Capture confirmation tests keep the heading and consent row visible at each supported width and scroll through long evidence. A terminal too small to show the consent controls cannot accept y. Prose wraps: normalize whitespace for meaning assertions in the loaded-command test, while physical width/row/control assertions keep the actual rendered strings.

Keyboard assertions here check which review the arrows select after Enter and view navigation. Actual view rotation is checked through the loaded command's rendered headings rather than callback argument values.

Why: a correct callback payload alone cannot prove that the operator can reach a view, and pressing Tab then Shift+Tab before checking focus can hide two incorrect focus toggles. Check arrow behavior after each key separately.

Coupled: components/code-review/src/panel.ts, components/code-review/src/review-manager.ts
Verify: components/code-review/tests/panel.test.ts, components/session-state/tests/review-queue.test.ts
