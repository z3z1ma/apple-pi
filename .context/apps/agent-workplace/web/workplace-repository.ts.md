## file

Code, Git and Knowledge subscribe to one device-local current repository. The existing workplace-git-root storage key remains the persistence owner; repository lists, editor buffers and view-specific data stay with their views. Initial discovery uses a functional choice so a late first repository list cannot replace an explicit selection made elsewhere. A fileRequest changes the shared selection through Code's existing navigation path. Reviews keeps its independent All repositories filter.
Why: separate mounted views otherwise drift, and a repository change must not discard unsaved Code models or implicitly change the review filter.
Coupled: apps/agent-workplace/web/workplace-code.tsx, apps/agent-workplace/web/workplace-git.tsx, apps/agent-workplace/web/workplace-knowledge.tsx
Verify: apps/agent-workplace/tests/world-knowledge.test.ts, apps/agent-workplace/tests/world-file-links.test.ts
