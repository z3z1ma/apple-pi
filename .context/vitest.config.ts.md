## file

The watchdog's configured-transport fixture is a plain transport-trial.ts script, executed by its test in a disposable Node process rather than discovered as a test itself. Preserve that boundary when changing include patterns.
Why: the fixture changes process-global fetch, proxy environment and dispatcher state to route synthetic provider traffic through a local HTTPS server. Importing it into the main Vitest process would mix those settings with unrelated suites; the real provider boundary must stay isolated without paid requests.

Coupled: components/anthropic-watchdog/tests/transport-trial.ts, components/anthropic-watchdog/tests/watchdog.test.ts
Verify: components/anthropic-watchdog/tests/watchdog.test.ts
