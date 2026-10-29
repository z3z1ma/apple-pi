## file

Changed-file rows match the 30px `.wp-icon-button` height owned by workplace.css; keep the row and shared icon dimensions coordinated if that control changes. The primary diff action shrinks and ellipsizes its path, while the separate editor icon remains visible at rest. Full current/previous paths stay in the row tooltip; rename metadata remains inline rather than adding a second row. Empty groups are absent, and branch text truncates instead of expanding the header.
Why: status scanning needs a steady row rhythm. Repeated View diff buttons and wrapped paths consumed the narrow sidebar without adding distinct choices. Shared icon affordances remain owned by Workplace's button styles rather than duplicated here.

The source-control sidebar contains the changes list and status; the main Code area owns the diff viewer. Keep the sidebar list shrinkable and independently scrollable. GitDiffText's pre relies on the `.wp-code-diff` wrapper in workplace-code.css for available height and visibility; the pre owns keyboard and pointer scrolling within that space. WorkplaceCode owns mounting and tab state.
Why: a bounded 340px sidebar could fit a diff technically while leaving the large editor area empty. Reading the patch in the main area uses the available width without discarding unsaved editor models.

Diff text is escaped preformatted content with backend whitespace retained. Added/removed spans use theme-tinted backgrounds and the normal text foreground; neutral file headers keep the surrounding diff color. Inline spans retain original newline characters rather than adding block-level line breaks. The scroll area is keyboard-focusable. Palette variables belong to Workplace; diff-text selectors are independent of the sidebar because the component renders in the main Code area.
Why: long unified-diff lines need horizontal scrolling without wrapping away structure. Block-level spans plus retained newlines would change visual spacing, and palette-aware normal text avoids relying on hue alone.
Coupled: apps/agent-world/web/workplace-git.tsx, apps/agent-world/web/workplace-code.css, apps/agent-world/web/workplace.css
Verify: apps/agent-world/tests/world-code.test.ts
