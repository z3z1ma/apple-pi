## symbol:installElectron

Electron's binary is downloaded by running `node_modules/electron/install.js` explicitly after `npm install --ignore-scripts`.
Why: npm 11 skips dependency install scripts unless approved, so `npm install electron` alone leaves no binary; running the installer ourselves works under either npm policy.

Every step runs in a staging directory `<dir>.installing-<pid>-<time>` beside the versioned directory, renamed into place only once it holds the binary and removed on any failure; staging directories of dead pids are removed at the next install, and a versioned directory without a binary is replaced.
Why: a failed or interrupted install must not leave a half-installed directory that the next `/workplace` trusts or trips over; the retry starts clean.
Verify: apps/agent-workplace/tests/launch.test.ts

The download runs `@electron/get` from the installed package itself (`DOWNLOAD`), printing `progress <n>` lines, and install.js then finds the zip in Electron's cache and only unpacks it.
Why: install.js draws its progress bar only on a terminal, so `/workplace` could show no progress; both use the same cache, version, and checksums, so the zip is downloaded once.
Coupled: extensions/agent-workplace.ts
Verify: apps/agent-workplace/tests/launch.test.ts

## symbol:startAgentWorkplace

Electron starts `src/electron/start.mjs`, not `main.js`: it installs the host-package resolve hook, then imports `main.js`. It writes `agent-workplace: loaded` to stderr on success; on failure it writes `agent-workplace: failed to load: <error>` and exits 1. The app's stderr goes to `<agent dir>/agent-workplace/electron.log`. The start counts as opened only when that loaded line appears, or on exit 0 (a second instance handing over to the first). Any other exit is a failure that reports the failed-to-load line.
Why: Electron does not quit when its main module fails to load (it shows an error dialog, which can be invisible under WSLg). The old "still alive after 2 s" check therefore reported success for an app that never loaded, and the operator saw "Opening Workplace" forever.
The environment carries `PI_HOST_PACKAGE_DIR` (`hostPackageEnv`), so that main's imports of Pi's own libraries resolve in an installed package (see register.mjs).
Verify: apps/agent-workplace/tests/launch.test.ts
