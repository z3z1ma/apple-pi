## file

The built renderer runs in real headless Chrome from the bare landing route. Graph, content, tree and source reads call the production backends over temporary fixture repositories; Git and Reviews are inert typed fixtures. This covers extraction through rendering and navigation, but skips Electron IPC and the operator's live runtime.

Held graph and content replies control two distinct interleavings: an old source selection finishing after a new reader is shown, and an old repository refresh finishing after another repository is selected. Final visible content and node identity distinguish rejection from mere request counts. The shared-root test checks both directions across Code, Git and Knowledge, retains an actual dirty Monaco model, and proves the Reviews filter stays independent.

Viewport-relative bounds and real clicks caught the initial root-class collision. Text range bounds catch the Knowledge rail label being clipped despite its whole button fitting. Drag checks the circle's centre against the held pointer; screenshots cover light/dark paint separately from those geometry checks.
Coupled: apps/agent-workplace/web/workplace-knowledge.tsx, apps/agent-workplace/web/knowledge-graph.tsx, apps/agent-workplace/web/workplace-repository.ts, apps/agent-workplace/web/workplace.css
Verify: apps/agent-workplace/tests/world-knowledge.test.ts, apps/agent-workplace/tests/knowledge.test.ts
