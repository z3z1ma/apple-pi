Type: interrogation
Status: resolved
Blocked by: 08, 09, 18

# Local API access control

## Question

How does the local backend authenticate clients and separate read from control?

Decide token issue and discovery for the desktop and browser clients, Origin/Host checks, whether browser clients can control agents or only view, and how this reuses or differs from the browser-pages token server.

## Answer

Decided with the operator, 2026-10-18.

- **Backend in Electron's main process.** It reads the session-state database, talks to the apple-pi runtime socket (mode `0600`, so only the operator's user reaches it), holds the GitHub, Jira, Confluence, and Slack credentials, and makes every external write. This also settles the backend placement that [Shell and service runtime](08-shell-and-service-runtime.md) handed to [Service lifetime](09-service-lifetime.md), which went out of scope without answering it.
- **IPC only.** The renderer reaches the backend through a narrow, typed preload bridge (Electron `contextBridge`); there is no network listener in the desktop app, so there is nothing to authenticate.
- **Secrets stay in the main process.** The renderer asks for an action; the main process performs it.
- **Browser mode later** reuses the browser-pages pattern: a listener on `127.0.0.1` only, a token minted at each launch, and Host and Origin checks. Whether a browser client may control agents or only view them is decided with that milestone.
