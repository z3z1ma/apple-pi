## symbol:WorkHistory

The team filter uses the task's recorded headquarters exactly, not today's reporting ancestry. A people filter selects actual assignment participants across organizations and labels the original anchor. Finishing an assignment is displayed separately from a task's done status; it is not proof that the whole task completed. Missing history in an older snapshot is distinguished from an empty known history. The inline summary stays compact. View work opens a viewport-bounded native modal with independently scrolling task navigation and detail, retaining every record without a result cap.

Task bodies mount only after an explicit Read task click. Reading registered task content is observation, not reading a thread/transcript; no seen or participation operation belongs here. Markdown uses the existing escaped renderer and explicit file/link bridge. Opening the modal is metadata-only; selecting a task mounts its body reader. Closing the modal discards pending reads, keeps an underlying profile open and restores the precise View work trigger.
Why: moving a person must not rewrite which team did historical work, and merely browsing organizational metadata must not acknowledge conversations or fetch every task body.
Coupled: apps/agent-world/src/world.ts, apps/agent-world/src/backend/workplace.ts, apps/agent-world/web/workplace-people.tsx, apps/agent-world/web/workplace-org-chart.tsx
Verify: apps/agent-world/tests/world-org.test.ts
