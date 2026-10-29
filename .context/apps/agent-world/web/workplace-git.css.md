## file

The source-control sidebar contains the changes list and status; the main Code area owns the diff viewer. Keep the sidebar list shrinkable and independently scrollable. GitDiffText's pre relies on the `.wp-code-diff` wrapper in workplace-code.css for available height and visibility; the pre owns keyboard and pointer scrolling within that space. WorkplaceCode owns mounting and tab state.
Why: a bounded 340px sidebar could fit a diff technically while leaving the large editor area empty. Reading the patch in the main area uses the available width without discarding unsaved editor models.

Diff text is escaped preformatted content with backend whitespace retained. Added/removed spans use theme-tinted backgrounds and the normal text foreground; neutral file headers keep the surrounding diff color. Inline spans retain original newline characters rather than adding block-level line breaks. The scroll area is keyboard-focusable. Palette variables belong to Workplace; diff-text selectors are independent of the sidebar because the component renders in the main Code area.
Why: long unified-diff lines need horizontal scrolling without wrapping away structure. Block-level spans plus retained newlines would change visual spacing, and palette-aware normal text avoids relying on hue alone.
Coupled: apps/agent-world/web/workplace-git.tsx, apps/agent-world/web/workplace-code.css
Verify: apps/agent-world/tests/world-code.test.ts
