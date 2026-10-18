Type: interrogation
Status: out-of-scope
Blocked by: 08

# Service lifetime

## Question

What starts the Agent World backend, how long does it live, and how many run?

Options: the backend inside Electron's main process (lives with the app), a separate Node process the app starts or attaches to, or a launchd agent that runs regardless of the app. Decide what happens when the window closes, on sleep/wake, and on tmux restart. Agents must keep running whatever the answer.

## Moved

Moved on 2026-10-18 to the shared state model task: `.ledger/202610172354-session-state-model/decisions/05-capture-and-transport.md`.
