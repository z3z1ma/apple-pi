## file

Not covered by tests: the operator checks it by hand (ticket 27). The token is read from `localStorage.localConfig_v2.teams[<team>].token` (team from the `/client/<team>` path, else `lastActiveTeamId`) and the `d` cookie from the window's own `persist:agent-world-slack` session with `cookies.get({ url: "https://app.slack.com/", name: "d" })`, which includes HttpOnly cookies.
Why: rusq/slackdump `doc/login-manual.md` reads the token the same way; the cookie API sees what page JavaScript cannot. If Slack moves the token, this is the one place to change.
Sign-in redirects can invalidate page JavaScript while polling. A failed token/cookie read waits for the next tick within the existing sign-in timeout rather than ending the flow during navigation.
Why: redirects are an expected part of authentication, not evidence that the operator cancelled it.

Coupled: apps/agent-workplace/src/electron/integrations-ipc.ts
