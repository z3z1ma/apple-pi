## file

Knowledge mounts only after the first visit and remains mounted while hidden. Renderer state retains the graph and current reader across application switches; Refresh, repository and mode changes request a new graph. Reads begun for superseded roots, modes or node selections cannot settle into the visible reader. A selected node's loaded ID must match before its content or source action is shown. There is no backend graph cache or watcher.

Open source in Code uses the shared FileReferenceNavigation provider, not an alternate editor or an external opener. Markdown uses the existing escaped conversation renderer; remote images remain inert. The explicit Links list uses backend graph IDs, including incoming links and unavailable targets.

The component root is wp-knowledge-view; the application shell's view marker is wp-knowledge. Keep these distinct. The first browser run found that sharing wp-knowledge made component flex and button rules style the entire application: the rail filled the viewport and the graph controls fell below it. Viewport-relative geometry and actual pointer actions protect that boundary.
Coupled: apps/agent-workplace/web/workplace.tsx, apps/agent-workplace/web/file-references.tsx, apps/agent-workplace/web/workplace-repository.ts, apps/agent-workplace/web/knowledge-graph.tsx
Verify: apps/agent-workplace/tests/world-knowledge.test.ts
