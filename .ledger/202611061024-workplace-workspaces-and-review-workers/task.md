Status: in-progress
Created: 2026-11-06
Updated: 2026-11-06

# Workplace workspaces per organization root, and review worker pools

## Intent

The operator (2026-11-06): each root session is its own workspace, like being signed in to several Slack workspaces. Switch by clicking the top-left mark (today static "pi"). Every view scopes itself to the chosen root.

Settled with the operator:

- **Workspaces.** Every organization root (awake or at home) is a workspace, named by its organization name, with initials and unread count. The last choice is remembered.
- **Chat and Mail.** Only channels, groups, DMs and mail whose members (other than the operator) include someone in the root's subtree. A thread touching two roots appears in every workspace it touches.
- **Org.** No team cards: the root's reporting tree in a split with the People directory, selection linked both ways, visual polish welcome.
- **Code, Git, Issues.** Unchanged.
- **Reviews.** Reviews whose owner is in the root's subtree; the repository filter stays.
- **Desk.** One desk. It works in the workspace whose root holds the desk coordinator; elsewhere the Desk tab says where it is run from, with "Go there" and "Run the desk from here" (the existing coordinator picker).
- **Review workers.** `review_code` takes an optional list of existing workers. Passes draw from them in order until exhausted, then use temporary peers ("temps"). An existing worker reviews in a forked continuation of its own conversation (`pi --fork`), which never touches its live session. Guidance only, in the tool description: prefer temps; name a worker only for a change it did not build or work on.
- **Badges.** Every temporary peer (reviews, programs, Ralph) shows "temp" wherever people appear; existing workers in a review show "worker".

## Acceptance

- Switching workspace changes Chat, Mail, Org, Reviews and Desk as above; Code, Git and Issues do not change. Checked in the built app in light and dark at 1440 and 900 px.
- A review with workers runs their passes as forks of their transcripts and the rest as temps; the workers' own sessions gain no entries. Tested over the real runtime with fixture peers.
- Badges visible in Org, Chat, Mail and Reviews.
- Delivered to the operator's running app.

## Current State

Shaped; building.

## Outcome

Pending.
