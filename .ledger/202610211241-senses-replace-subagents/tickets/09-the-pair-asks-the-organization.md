# 09: The pair asks the organization

**What to build:** The pair programmer gets `ask_for_second_opinion(question, to?)` and a read-only `directory`, replacing `ask_consultant` and the hidden consultant run. The mail goes in the main session's name, marked as from its pair, to `to` or the main session's manager. With no manager and no `to`, the tool refuses and says to name someone; the operator is reached only when named; with nobody to ask it says so. The main session is in the thread, so the reply is pushed to it and the pair sees it in the trajectory. The consultant agent, consultation context, managed-subagent service, and the pair's escalation and gate code are deleted.

**Blocked by:** 01 Mail is threads, 02 The directory and human-named manager tools

**Status:** ready-for-agent

- [ ] From a hired person's pair, a second opinion reaches its manager in a thread with the main session, and the reply arrives in the main session.
- [ ] Naming another person sends it to them instead.
- [ ] From a session with no manager, a call without `to` is refused with the instruction to name someone, and the operator receives nothing.
- [ ] The pair has no `ask_consultant`, and no consultant run happens (pair harness).
