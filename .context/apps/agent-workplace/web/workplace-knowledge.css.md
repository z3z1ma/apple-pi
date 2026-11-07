## file

Scope content and form rules to wp-knowledge-view, which differs from the shell's wp-knowledge marker. Reader and graph have independent bounded areas: long Markdown and link lists scroll inside the reader rather than increasing the application height. The graph's colours live in `knowledge-graph.tsx` palettes because the canvas draws them; this file only lays out the canvas, its invisible per-node buttons (pointer-transparent, so the canvas receives all pointer input) and the overlaid controls.
Coupled: apps/agent-workplace/web/workplace-knowledge.tsx, apps/agent-workplace/web/knowledge-graph.tsx
Verify: apps/agent-workplace/tests/world-knowledge.test.ts
