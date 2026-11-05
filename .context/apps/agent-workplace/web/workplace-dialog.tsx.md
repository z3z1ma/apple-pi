## file

WorkplaceDialog is the in-app confirm or input dialog shared by Git and Reviews: a scrim over the nearest positioned ancestor, a form whose submit confirms, and Escape that cancels without reaching window-level Escape handlers (Git's diff closes on Escape). Callers pass fields as children; the confirm button is disabled while `disabled` holds. Its parent app root must be `position: relative`.
Why: the two apps needed the same dialog; window.confirm could not be themed and broke the app's look.
Coupled: apps/agent-workplace/web/workplace-dialog.css, apps/agent-workplace/web/workplace-git.tsx, apps/agent-workplace/web/workplace-reviews.tsx
Verify: apps/agent-workplace/tests/world-git.test.ts, apps/agent-workplace/tests/world-reviews.test.ts
