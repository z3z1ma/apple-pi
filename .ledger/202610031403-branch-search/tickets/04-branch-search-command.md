# 04: `/branch-search` with a hidden authored scorer

**What to build:** The first feature a user can run. `/branch-search [goal]` starts a search whose scorer a role fork writes from the conversation (spec 5.1, 6.2, 10.1). Validation failures go back to the author up to the configured retry count (6.3). The harness freezes the scorer and keeps it off disk, and runs no scorer command, while any enumerator or branch runs (8.4, phase separation). An optional review profile can refine the scorer once (10.5). The search ends with one passive report message (6.10). The feature stays off while required configuration keys are missing (11). The command, its status and cancel subcommands, the docs page, the README catalog, the package manifest, and the loader test land together (13, 20).

**Blocked by:** 03 (Validation, objectives, and automatic apply).

**Status:** ready-for-agent

- [ ] On the fixture repository with scripted model replies, `/branch-search <goal>` authors and validates a scorer, runs roots, and applies the passing approach although it is not the model's preferred candidate (A6). The parent conversation gains exactly one passive message, whose first line is the summary (I7).
- [ ] An authored scorer that fails validation goes back to the author with the validation report; after the configured retries, the search ends `aborted: scorer invalid`.
- [ ] The record stores the frozen scorer's SHA-256, which equals the hash of the stored spec file, and no enumerator or branch starts before the hash is recorded.
- [ ] A branch that runs `find / -name spec.json` and a recursive grep for a gate command string finds neither the active search's scorer nor its installed files (A2).
- [ ] No process started by a branch is still running when scoring of its generation starts.
- [ ] With a review profile set, a `refine` verdict replaces the scorer once; without one, no review request is sent.
- [ ] `/branch-search status` prints the search ID, phase, branch counts per state, and elapsed time. `/branch-search cancel` ends the search `aborted: cancelled` and cleans up. A second `/branch-search` while a search runs prints the active search ID and starts nothing.
- [ ] Issued while the root run streams, the command shows `branch search queued` and starts at the next settle.
- [ ] With a required configuration key missing, `/branch-search` prints the missing keys and starts nothing.
- [ ] The branch-search docs page, README catalog, package manifest, and loader test include the command.
