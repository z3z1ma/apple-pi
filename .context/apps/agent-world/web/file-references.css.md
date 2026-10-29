## file

Keep local-reference styling beneath .wp-app, including keyboard focus treatment. The shared transcript imports the decorator in both Workplace and standalone World, so stylesheet loading alone is not evidence that local-file navigation is enabled.
Why: global anchor or Markdown styles would change World's existing visual/link contract even when its navigation context leaves decoration disabled. Native dialog top-layer presentation still retains its Workplace DOM ancestry for these selectors.
Coupled: apps/agent-world/web/file-references.tsx, apps/agent-world/web/overlay/conversation/transcript.tsx
Verify: apps/agent-world/tests/world-file-links.test.ts
