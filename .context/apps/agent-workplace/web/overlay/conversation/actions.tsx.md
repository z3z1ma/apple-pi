## symbol:Actions

The action buttons cancel their `mousedown`, so clicking one never takes the focus from the reply box; the box takes the focus when the panel opens, after the transcript's own focus effect.
Why: the ticket asks that the box keep the focus, so the operator can type, send, and type again without clicking back.
Verify: apps/agent-workplace/tests/world-conversation.test.ts

The reply box offers @mentions from the `MentionPeople` context, which Workplace provides around its embedded DM. Without a provider (the World panel) the box has no mention list and sends text unchanged.
Why: the World overlay has no snapshot of people at this level; passing it as a prop would thread it through every panel.
Coupled: apps/agent-workplace/web/workplace.tsx, apps/agent-workplace/web/workplace-mentions.tsx

## symbol:Footer

When the questionnaire shown here leaves the facts, the note says the operator answered it only if an `answer` for that questionnaire id was sent from the panel and did not fail; otherwise it was answered in its terminal (a late answer fails as not open and counts as the terminal's).
Why: the runtime records no answerer in the prompt's close, so the panel's own record of what it sent is the only way to tell the two apart.
Verify: apps/agent-workplace/tests/world-conversation.test.ts
