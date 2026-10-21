# 05: A hired person has a soul

**What to build:** At hire the runtime draws a soul with no model call from local lists in the package, like names: a stance, an evidence taste, a risk appetite, a length, an outlook on estimates, and one habit from a long list. It is stored on the person and rendered as a short paragraph under the role in the `<role>` section at every start. The operator's own sessions have none. Two people hired with the same role differ by soul. The directory shows one line of each person's soul.

**Blocked by:** 01 A session started with a role is that role

**Status:** ready-for-agent

- [ ] Two hires with the same role on one runtime have different souls in their prompts and the same role body.
- [ ] A reopened person has the same soul as before; a session started by hand without a role has no soul paragraph.
- [ ] The habit list holds at least thirty distinct habits, and the draw is covered by a test that checks every field is filled from its list.
- [ ] `list_peer_sessions` shows one soul line per hired person.
