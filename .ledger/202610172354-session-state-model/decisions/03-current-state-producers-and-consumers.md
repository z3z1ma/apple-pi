Type: research
Status: resolved
Blocked by: 

# Current state producers and consumers in apple-pi

## Question

Which apple-pi components produce or consume session state today, in what format, and with what guarantees?

Start from the Agent World inventory (`.ledger/202610171741-guildworld/research/apple-pi-integration-inventory.md`) and extend it: tmux-sessions records and `agents.py` (sidebar, dashboard, notch feed, status line, jump), the coordinator skill's live list, the mailbox, ledger `history.json` session links, subagent persistence and its views, session titles, notify, change and learning reflection forks, and the pair programmer's notebook entries. For each: what it reads, what it writes, its freshness, and what it would gain from a shared model.

## Answer

Findings: [state producers and consumers](../research/state-producers-and-consumers.md).

- Five consumers (sidebar, dashboard, status line, notch, coordinator) each re-derive "who runs and in what state" from tmux records plus a live tmux check; only the sidebar adds tool activity and task titles.
- Freshness, liveness rules, and identities differ across components: Pi session id, pid plus pane plus socket, random subagent ids with `parentAgentId`, and session id plus leaf id.
- Subagent, task, fork, and pair state is in memory only; no consumer spans several tmux servers.
