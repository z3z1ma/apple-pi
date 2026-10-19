# 27: Slack sign-in and the town square

**What to build:** First the Slack credential approach is settled with the operator (deferred in the spec) and recorded. Then he signs in, and each Slack channel with unread messages stands in the town square as a townsperson. The square is kept calm by a bound designed with him. The unread orb and the Slack tab join the interface, and townsfolk looks come in all three themes.

**Blocked by:** 08 The interface; 20 Anime school pack

**Status:** done

- [x] The credential decision is recorded in the task before any Slack code lands, and credentials live only in the backend's private file.
- [x] In the backend API test against a fake Slack server, channels with unread messages become townsfolk, and the bound holds when there are many.
- [x] The unread orb and the Slack tab match the fake server's unread counts.
- [x] Meets the bar in the polish bar in the [spec](../spec.md#further-notes): judged on captured screenshots and a short recording, not on passing tests alone.

## Credential decision (recorded 2026-10-19, before any Slack code)

Agent World keeps the operator's own choice from [Source of SaaS work data](../decisions/07-source-of-saas-work-data.md): he signs in to Slack in an Electron window opened at `https://app.slack.com/`; after sign-in the backend reads the web client's session token (`xoxc-…`, from the page's local configuration) and its `d` cookie (Electron's session cookie API, which sees HttpOnly cookies), and calls Slack's Web API as the operator with both. Both are kept only in the backend's private `0600` credentials file under `~/.pi/agent/state`, never in the renderer, logs, or themes. Signing out deletes them. The officially scoped app token stays out of scope (map Out of scope); this works without a workspace admin, but some workspaces forbid it, which the Settings sign-in says.
