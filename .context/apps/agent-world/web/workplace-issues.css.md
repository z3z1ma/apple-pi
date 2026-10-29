## file

Issues uses Workplace semantic palette variables in both appearances. Its root fills the shell's plain height-constrained wrapper explicitly (flex:1 alone has no effect under that block parent). Its list and detail have independent scroll regions; at narrow widths an open detail replaces the list and the Close action returns to it. Explicit hidden selectors override flex display for the tab, credential-gated layout and retained per-issue detail panels.
Why: hidden issue panels keep draft and receipt state without remaining visible or keyboard-accessible, and global display rules must not expose them again.

Row metadata has one grouped container: the full-width list aligns its fields, while the split view puts them on one line below the title. The selected list keeps a readable minimum width; at narrow widths the detail replaces it. The long description and comment content are inside the finite detail-body scroller, with its key and Close action outside.
Why: separate metadata grid columns in the split view created tall rows and could generate implicit columns. A retained issue can be outside current search results, so its key stays in the headline and that relationship is stated beside the pinned key.

The Jira write confirmation is a native dialog in the same Workplace subtree, so it inherits the palette while its top layer owns modal focus. Styles stay scoped to Issues and its dialog rather than restyling the World integration views.

Coupled: apps/agent-world/web/workplace-issues.tsx, apps/agent-world/web/workplace.css
