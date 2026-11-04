## file

Keep `maxWorkers` at a fraction of the cores, not the default.
Why: the default of one worker per core saturates the machine the operator also works on.

Keep `PI_SESSION_STATE_DISABLED=1` in the test environment.
Why: only the session-state suites start a runtime daemon, each in its own temporary directory; the flag keeps every other suite from starting or joining one.

The watchdog's configured-transport fixture is a plain transport-trial.ts script, executed by its test in a disposable Node process rather than discovered as a test itself. Preserve that boundary when changing include patterns.
Why: the fixture changes process-global fetch, proxy environment and dispatcher state to route synthetic provider traffic through a local HTTPS server. Importing it into the main Vitest process would mix those settings with unrelated suites; the real provider boundary must stay isolated without paid requests.

Coupled: components/anthropic-watchdog/tests/transport-trial.ts, components/anthropic-watchdog/tests/watchdog.test.ts
Verify: components/anthropic-watchdog/tests/watchdog.test.ts

Writing and running tests here:
- Vitest hides `console.log` from passing tests. To inspect values in a scratch test, write them to a temporary file and read it, or assert on them.
- There is no tsx, jiti or vite-node. To run one-off TypeScript against repository sources, write a temporary `*.test.ts` in an included directory, run it with `npx vitest run <file>`, and delete it afterwards. Keep checks that wait for a human or a browser outside the test tree; copy them in only to run them, and remove the copy in the same command (a leftover copy hangs the suite). To run repository TypeScript in its own Node process, use `node --import components/session-state/src/register.mjs file.ts`; only erasable syntax works.
- To cover OS branches in one process, override `process.platform` with `Object.defineProperty` and restore the saved descriptor in `finally`.
- File-watch tests need `waitFor` timeouts above the 1 s default; under load, notifications lag past it.
- Run Vitest to a log (`npx vitest run <file> > /tmp/x.log 2>&1`) and read the log: a run through RTK can report exit 0 after an import failure.
