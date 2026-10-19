# 25: Working Jira issues

**What to build:** The operator comments on or moves an issue as himself through the outside-write gate, or hands it to the coordinator.

**Blocked by:** 13 Instructing an agent from the panel; 22 Reviewing a pull request; 24 Atlassian sign-in and the quest office

**Status:** done

- [x] A comment or transition is sent to the fake Jira server only after confirmation and is logged like other outside writes.
- [x] Moving an issue offers only the transitions Jira allows for it.
- [x] Hand to the coordinator sends the issue to the coordinator as an instruction and writes nothing to Jira.
