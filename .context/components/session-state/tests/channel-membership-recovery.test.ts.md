## file

The fixture writes a stopped runtime with accepted membership commands at both crash boundaries. Only the fixture writes the database; the runtime then reconciles channels and replays those commands.
Why: writing during the runtime's replay would hide which side recovered the membership.
Verify: components/session-state/tests/channel-membership-recovery.test.ts
