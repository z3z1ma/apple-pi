## symbol:installElectron

Electron's binary is downloaded by running `node_modules/electron/install.js` explicitly after `npm install --ignore-scripts`.
Why: npm 11 skips dependency install scripts unless approved, so `npm install electron` alone leaves no binary; running the installer ourselves works under either npm policy.

Every step runs in a staging directory `<dir>.installing-<pid>-<time>` beside the versioned directory, renamed into place only once it holds the binary and removed on any failure; staging directories of dead pids are removed at the next install, and a versioned directory without a binary is replaced.
Why: a failed or interrupted install must not leave a half-installed directory that the next `/world` trusts or trips over; the retry starts clean.
Verify: apps/agent-world/tests/launch.test.ts

The download runs `@electron/get` from the installed package itself (`DOWNLOAD`), printing `progress <n>` lines, and install.js then finds the zip in Electron's cache and only unpacks it.
Why: install.js draws its progress bar only on a terminal, so `/world` could show no progress; both use the same cache, version, and checksums, so the zip is downloaded once.
Coupled: extensions/agent-world.ts
Verify: apps/agent-world/tests/launch.test.ts

## symbol:startAgentWorld

The app's stderr goes to `<agent dir>/agent-world/electron.log`, and the start is watched for `START_WATCH_MS`; an exit with code 0 in that time (a second instance handing over to the first) counts as opened.
Why: a detached start with ignored output gave no reason when Electron could not run; the watch says why without keeping Pi attached to the app.
Verify: apps/agent-world/tests/launch.test.ts
