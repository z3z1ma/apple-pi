# 10: `/org` for the operator

Part of the approved spec [../spec.md](../spec.md); its Terms table defines obligation, completion, window, horizon, and the other words used here.

**What to build:** In a root session, the operator types `/org <since>` (for example `/org 7d`; a window the caller states, as with the tool) and sees the organization's fitness (total, rate, contributions, coverage and provenance, delay by state, spend on dropped work, impacts, findings, open waits, interruptions, the unmeasured attention term) and its recorded scenarios with their observations, read from the same module the tools use.

**Blocked by:** 06 (Delay by state, open waits, and operator interruptions), 07 (Impacts, defects, and review findings), 08 (Spend on dropped work), 09 (Scenarios and recorded predictions).

**Status:** ready-for-agent

- [ ] Through a faux session against a spawned runtime with a known history, `/org 7d` shows the same total and prediction states as the shared module returns for the same window.
- [ ] `/org` without a window explains how to give one, and shows no number.
- [ ] The package-load smoke test lists the `/org` command.
