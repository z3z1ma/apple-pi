## file

Import this module only through the `React.lazy` in `workplace-desk.tsx`, never statically. Tiptap and ProseMirror live in its own chunk.
Why: a static import pulled the editor into the main Workplace bundle and grew it from 265 KB to 739 KB, slowing every app start for a view the operator opens rarely.
Coupled: apps/agent-workplace/web/workplace-desk.tsx
