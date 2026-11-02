## file

Notes are the organization's own knowledge, owned by the runtime so every person and project reads the same store, unlike a project's `.wiki`. A connection is not a separate record: it is a note whose refs name the activity items, URLs, tasks or threads it connects, which is how Workplace finds the notes beside an outside item (`readNotes` by ref). Writes go through the runtime (`note` command); readers open the database read-only.
Coupled: components/session-state/src/activity-tools.ts, apps/agent-workplace/src/backend/workplace.ts, apps/agent-workplace/web/workplace-notes.tsx, roles/scout.md
Verify: components/session-state/tests/outside-activity.test.ts
