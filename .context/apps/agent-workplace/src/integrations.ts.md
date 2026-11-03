## file

These types are shared by the backend, the preload, and the renderer. Credentials never appear here. Settings may know the site, email, and workspace, never a token, cookie, or password. Jira and Confluence HTML is untrusted and must be sanitized before it is shown.
Why: the renderer is the untrusted side of this contract. A field added for convenience can leak a secret or render remote HTML.

The `slack-mark-read` intent needs no second confirmation, unlike publishing a reply or changing an issue.
Why: marking a Slack channel or thread read is already the operator's explicit action.

Coupled: apps/agent-workplace/src/backend/integrations/credentials.ts, apps/agent-workplace/src/electron/preload.ts, apps/agent-workplace/web/overlay/places/rich-text.ts
Verify: apps/agent-workplace/tests/integrations/atlassian.test.ts, apps/agent-workplace/tests/integrations/slack.test.ts
