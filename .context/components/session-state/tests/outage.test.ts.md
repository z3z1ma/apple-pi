## file

The session does not depend on the runtime for its own prompt. After a kill, the bridge starts a new runtime and sends its whole current state. The recorded gap starts no later than the kill and ends after it. Run-state changes during the outage are not in the history; history from before the outage stays. When that replacement runtime dies too, the bridge starts another.
Why: a prompt that waited on the runtime would hide the outage, and a gap that starts after the kill would miss it.
Verify: components/session-state/tests/outage.test.ts
