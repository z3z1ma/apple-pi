## file

Keep the watchdog extension before extensions that can begin provider requests during session startup, including the pair programmer. Its root-session discovery and published source are separate from the intern runner's explicit child-process loadout.
Why: subscriptions must exist before a startup request begins, and process-wide observation cannot cross a subprocess boundary. A source module present in the checkout but omitted from the package files allowlist would also leave the published extension unable to load.

Coupled: extensions/anthropic-watchdog.ts, components/interns/src/runner.ts, docs/anthropic-watchdog.md
Verify: tests/package-load.mjs, components/interns/tests/interns.test.ts, components/anthropic-watchdog/tests/watchdog.test.ts
