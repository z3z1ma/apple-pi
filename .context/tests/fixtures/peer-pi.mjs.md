## file

A --fork launch uses Pi's real SessionManager.forkFrom with the launch's new ID and cwd. Restore the forked context's actual model/role while continuing to append only to its new file. Load the narrow SessionManager module only for forks; importing the whole package into every scripted temp materially slowed concurrent runtime tests. Fixtures still do not execute the real CLI or a paid provider.
Coupled: components/session-state/tests/review-workers.test.ts
Verify: components/session-state/tests/review-workers.test.ts

A launch profile selects the first model of that profile from the profile file.
Why: the fixture must follow the real role resolver rather than invent a model the production path would not pick.

`unresponsive` in peer-control.json makes the peer ignore SIGTERM, SIGHUP and its closed input, like a hung Pi process, so only SIGKILL ends it.
