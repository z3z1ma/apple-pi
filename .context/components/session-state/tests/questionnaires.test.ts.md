## file

The dialog types the same choices the test names. A session left open would start a new runtime after the test stops this one.
Why: `dispose` alone does not emit shutdown, so the bridge would start a daemon into a directory the test is deleting.
Verify: components/session-state/tests/questionnaires.test.ts
