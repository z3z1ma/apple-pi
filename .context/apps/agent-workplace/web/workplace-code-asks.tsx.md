## file

Inline threads are not rendered inside Monaco. Each thread reserves space with an empty view zone after its last line. The thread itself sits in `.wp-code-ask-layer`, a sibling of `.monaco-editor` inside the editor host. It is positioned from the zone node's on-screen rectangle (`place`), and hidden while Monaco does not render that zone.
Why: Monaco's view-zone container is `aria-hidden`, which hides a thread from screen readers and from role queries, and the editor captures mouse and keyboard events inside its own DOM. Zones after the same line stack in Monaco's order, so copying their rectangles stacks the threads too.

The editor's agent actions mail the desk person or the file's last editor. A review is captured with `reviews.preview` and then `reviews.enqueue`, owned by the desk person. Replies are read by polling `communications.readThread` (and the review's summary and findings) only while Code is visible. Mail threads have no snapshot sequence to watch.

In tests, wait a moment after Monaco's context menu opens before clicking an item. The menu ignores a click that lands within its open guard, so an immediate scripted click does nothing; human clicks are unaffected.

Coupled: apps/agent-workplace/web/workplace-code.tsx, apps/agent-workplace/src/backend/code-authors.ts, apps/agent-workplace/src/electron/main.ts
Verify: apps/agent-workplace/tests/world-code.test.ts, apps/agent-workplace/tests/code-authors.test.ts
