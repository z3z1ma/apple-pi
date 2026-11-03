Status: done
Created: 2026-11-02
Updated: 2026-11-02

# Desk intelligence: a runtime activity stream the coordinator acts on, and open-ended exploration

## Intent

The operator wants to feel the organization's intelligence. The runtime watches his Slack, GitHub and Jira activity as his own settings define it, keeps one stream of it, and the desk acts on that stream proactively. A scout explores the connected systems, connects threads he would not have connected, and builds knowledge. This works the same from the terminal; Workplace is its best interface. See `proposal.md`.

## Decisions (operator, 2026-11-02)

- Exploration belongs to a scout, a lasting person reporting to the coordinator.
- Durable knowledge lives in org notes owned by the runtime, shared across projects.
- Triage: everything reaches the coordinator by default (most proactive), metered. The triage mode (all, direct only, off) is chosen per source in the runtime and in the UI, since GitHub is already filtered by his watches and Slack by his notification settings.
- The coordinator runs a cheaper model for this load; GPT-6.1 Terra is his suggestion.
- Build order is mine to choose. Slack is signed in again (checked: `client.counts` and `activity.feed` answer).

## Done when

- The runtime polls GitHub notifications, Jira issues that involve him, and Slack activity plus DMs, and keeps one deduplicated stream with cursors that survive restarts.
- Workplace Activity shows that stream with agent items, grouped by conversation, with source and kind filters and a per-source triage mode.
- The coordinator receives new items in batches, records a decision on each (task, draft, link, pass with reason), and Activity shows it. The coordinator role no longer schedules sweeps itself.
- Rules (hide, quiet, route, label) can be made from an item and by agents, and apply on arrival.
- A scout explores on a schedule and when triage asks, records connections as links with evidence and knowledge as org notes, both visible in Workplace and readable with native tools.
- Focused tests cover each piece; each step is committed and activated.

## Current State

All six steps are built, committed and live (runtime schema 48, app relaunched):

- Stream: GitHub, Jira and Slack read each minute (`04c54ab5`, `9d7a3026`); all three set to `all` for the operator.
- Triage: proven live. The coordinator decided all 186 first-day items (177 pass, 4 answer, 3 draft, 1 link, 1 task), delegating verification to Lula.
- Rules (`f494f78c`) and notes plus the scout role (`eb4a818d`): built and tested with fixtures, not yet used live.
- Model: `desk` profile (`117a553e`); the live coordinator runs Terra xhigh. An explicit model choice now persists across restarts (`a48ad891`).

- Calendar and email (`d6f83588`) through `gws`: live; calendar `all`, email `direct`. The coordinator triaged the first calendar and email items within a minute.
- The live `model-profiles.json` has its `desk` entry (Terra xhigh, then Sol high), added after the operator reloaded every session.

Open: the scout is not hired yet (asked the coordinator by mail); exploration and notes are unproven live.

## Outcome

Done. All six steps are built and live: the activity stream (GitHub, Jira, Slack, calendar, email), coordinator triage (proven on 186 first-day items), rules, notes, the scout role, and the desk model profile. The scout (Tamar Brannigan) is hired, but exploration and notes have not been observed over time.

### Assignment 744: Tadhg Marinescu

Closed during the operator's ledger cleanup. The activity stream, triage, rules, notes, the scout role and the desk model are live. Exploration and notes have not been observed over time.
