## file

Listing fetches metadata/previews, while opening the editor fetches the body. Leaving attempts to flush pending edits; slash insertion focuses synchronously for the next keystroke. Snapshot refresh starts a reload only while the draft is clean.
Why: browsing must not eagerly load whole documents or lose pending edits on navigation. Hazard: load's async response currently applies unconditionally, so a clean-at-start check alone is not proof it cannot race a later edit.

Import this module only through the `React.lazy` in `workplace-desk.tsx`, never statically. Tiptap and ProseMirror live in its own chunk.
Why: a static import pulled the editor into the main Workplace bundle and grew it from 265 KB to 739 KB, slowing every app start for a view the operator opens rarely.
Coupled: apps/agent-workplace/web/workplace-desk.tsx
