## file

The graph draws on one canvas so a real repository (this one: 933 context nodes, 3241 links) stays smooth and readable; the first SVG version showed a dense bunch of overlapping labels at that size, which the operator rejected (2026-11-07) and asked for Obsidian's "galaxy" look instead. Do not go back to one DOM element per drawn node and label.

Points are copies of the API nodes, so D3 writes positions into them and never into the graph the backend returned. Rendering is dirty-flagged: a frame draws only after a simulation tick, camera change, hover, selection, resize or theme change (`data-appearance` is observed). The simulation starts from D3's spiral after 40 silent ticks and blooms visibly; while it settles the camera eases toward a fit of all nodes until the operator zooms, pans or drags. Orphans get a stronger centre pull so they ring the galaxy rather than drift away.

Look: folder clusters (first three path segments) pick a palette colour; node size grows with the square root of degree; additive glow sprites in dark mode make dense clusters read as nebulae, and light mode uses the same layout with plain blending. Labels never overlap: candidates are placed greedily by priority (lit node, its neighbours, then degree) into free boxes, and fade in with on-screen node size, so the overview names only hubs. Hover or selection lights a node's neighbourhood and dims the rest.

Each node also has an invisible, pointer-transparent `Read <path>` button kept at its on-screen position. It gives assistive technology and tests a target per node; the canvas handles all pointer input through `simulation.find`. Selection re-centres on the node after the canvas resizes for the reader.
Coupled: apps/agent-workplace/web/workplace-knowledge.tsx, apps/agent-workplace/web/workplace-knowledge.css, apps/agent-workplace/src/knowledge.ts
Verify: apps/agent-workplace/tests/world-knowledge.test.ts
