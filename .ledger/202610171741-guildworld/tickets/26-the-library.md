# 26: The library

**What to build:** The library, painted in all three themes, searches all of Confluence and shows pages read recently. A page reads in a panel or opens in the browser, and the operator can ask an agent to summarise or update it.

**Blocked by:** 13 Instructing an agent from the panel; 24 Atlassian sign-in and the quest office

**Status:** ready-for-agent

- [ ] In the backend API test against a fake Confluence server, search returns pages from every space and a page renders in the panel.
- [ ] Pages opened in the library appear in its recent list.
- [ ] Asking an agent sends an instruction naming the page and writes nothing to Confluence.
- [ ] The library is required in the pack check and present in all three packs.
- [ ] Meets the bar in the polish bar in the [spec](../spec.md#further-notes): judged on captured screenshots and a short recording, not on passing tests alone.
