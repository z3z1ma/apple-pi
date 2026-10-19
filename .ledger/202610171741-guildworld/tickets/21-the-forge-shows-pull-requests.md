# 21: The forge shows pull requests

**What to build:** The forge, painted in all three themes, shows open pull requests that involve the operator or his agents on its workbenches, read through `gh`. Each one's CI state shows as passing, failing, or running. Pull requests link to agents by branch. Each one offers Open in GitHub.

**Blocked by:** 08 The interface; 20 Anime school pack

**Status:** ready-for-agent

- [ ] In the backend API test with a fake `gh`, the forge lists the expected pull requests with CI state, and links a pull request to the agent whose branch matches.
- [ ] The forge is required in the pack check and present in all three packs.
- [ ] Open in GitHub opens the pull request in the browser.
- [ ] Meets the bar in the polish bar in the [spec](../spec.md#further-notes): judged on captured screenshots and a short recording, not on passing tests alone.
