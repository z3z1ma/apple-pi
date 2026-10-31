## file

The frame, queue entries, scrolling evidence and mouse hit regions share the viewport. Each queue entry occupies four physical rows; its producer, page sizing and mouse selection must change together. Clicking a pane heading changes focus without selecting a content row. Selection follows review identity through paging, reordering and resize. Wrapped-line position is local to the current evidence page, not aggregate review coverage.

Evidence navigation stays independent of pane focus and review selection. Cycling a view resets its detail page without hiding the overlay; choosing a captured file/side is a separate action, so merely passing through Source opens no modal prompt. The operator rejected the previous modal view selector and Tab-as-pane-toggle interaction.

Terminal data is untrusted display text. Strip terminal controls before applying theme styles, then wrap the styled evidence so long finding headings retain their visual hierarchy across lines. Measure cell widths with the TUI helpers rather than string length. Completed execution uses the neutral accent, not the approval/success color: findings, coverage, missing intent, freshness and operator approval remain separate claims.

Capture confirmation reserves its heading and consent controls before allocating scrollable content. A viewport that cannot display those controls refuses confirmation. Cancellation belongs to the overlay owner in review-manager; a visual close must not claim rollback of a submitted mutation.

The operator rejected the first functional scaffold. The subsequent frame, focus markers, semantic colors and finding-first presentation were inspected through the installed Pi command in an isolated tmux terminal. Component geometry alone is not visual acceptance, and captured terminal cells rendered to an image are not a screenshot of the operator's desktop. The task evidence records the actual inspected states.

Coupled: components/code-review/src/presentation.ts, components/code-review/src/review-manager.ts
Verify: components/code-review/tests/panel.test.ts, components/session-state/tests/review-queue.test.ts
