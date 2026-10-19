## file

Not covered by tests: the operator checks it by hand (ticket 27). The token is read from `localStorage.localConfig_v2.teams[<team>].token` (team from the `/client/<team>` path, else `lastActiveTeamId`) and the `d` cookie from the window's own `persist:agent-world-slack` session with `cookies.get({ url: "https://app.slack.com/", name: "d" })`, which includes HttpOnly cookies.
Why: rusq/slackdump `doc/login-manual.md` reads the token the same way; the cookie API sees what page JavaScript cannot. If Slack moves the token, this is the one place to change.
Coupled: apps/agent-world/src/electron/integrations-ipc.ts
