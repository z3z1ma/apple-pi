# 24: Atlassian sign-in and the quest office

**What to build:** In Settings, the operator enters his Atlassian email and API token, which are kept in a private `0600` file in the backend and never reach the world UI. The quest office, painted in all three themes, shows the Jira issues assigned to him and searches across every issue. An issue opens in a panel and offers Open in Jira.

**Blocked by:** 20 Anime school pack

**Status:** ready-for-agent

- [ ] In the backend API test against a fake Jira server, the quest office lists the assigned issues and search returns matching issues from any project.
- [ ] The credential file is mode `0600`, and no credential appears in the renderer, the logs, or the theme files.
- [ ] The quest office is required in the pack check and present in all three packs.
- [ ] Meets the bar in the polish bar in the [spec](../spec.md#further-notes): judged on captured screenshots and a short recording, not on passing tests alone.
