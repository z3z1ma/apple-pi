## file

D3 owns force positions only; React owns the SVG, selection, camera and pointer/keyboard interactions. Simulation mutates cloned graph nodes, never the API DTO. Stopping the hidden view's simulation preserves its layout, and disposal stops its timer. Fit follows the initial simulation until the operator interacts; later movement belongs to the operator. Node and label sizes compensate for camera scale.

SVG node groups are keyboard-activated buttons because HTML buttons cannot be children of an SVG group. Pan and node drag share SVG pointer capture; cancellation releases pinned positions and cools the simulation. Edge colours represent Coupled, Verify and wiki; node colours group folders and never introduce directory edges.
Coupled: apps/agent-workplace/web/workplace-knowledge.tsx, apps/agent-workplace/web/workplace-knowledge.css, apps/agent-workplace/src/knowledge.ts
Verify: apps/agent-workplace/tests/world-knowledge.test.ts
