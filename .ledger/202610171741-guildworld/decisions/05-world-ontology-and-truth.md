Type: interrogation
Status: resolved
Blocked by: 01

# What Agent World abstracts in tmux and Pi

## Question

What does Agent World abstract, from first principles, and which world entities follow from that?

Start from what tmux and Pi actually are: tmux servers, sessions, windows, and panes; root Pi sessions and their `reportsTo` supervisor; subagents and `pi_exec` workers, which publish nothing today; ledger tasks; and mailboxes. Decide which of these the world shows as entities, how they map (for example whether a tmux session is a place or a group), what the coordinator (the session that runs the `coordinator` skill; the Guildmaster in the fantasy theme) is in those terms, and where Jira, GitHub, and Confluence attach. Decide whether world roles exist at all, given that Pi sessions are mostly alike and subagent types are separate from them. Fix the truth classes (observed, inferred, decorative, stale) and the status projection (`busy`/`idle`/`waiting` plus `stale`/`stopped`/`unknown`).

The handoff's entities (Hero, Summon, Party, Quest, Assignment, AttentionItem, Place, WorldPlacement, PresentationIdentity) and personas are inputs to challenge, not defaults. Record resolved terms in a Agent World domain-language page.

## Answer

Decided with the operator, 2026-10-18. Glossary: `.wiki/pages/agent-world-language.md`.

- **Character:** one live root Pi session in tmux. Its look is cosmetic, fixed per session id, and carries no role.
- **Relations (observed only):** a **coordinator** is a session whose id is listed in Agent World's settings; a **worker** reports to a coordinator (`reportsTo`); every other session is an **independent session**. No other roles exist.
- **Places:**
  - each coordinator has its own themed **headquarters** [Guild Hall], where it stands;
  - a coordinator's workers live in a **wing** of its headquarters, one wing per tmux session they run in;
  - independent sessions live in a **building**, one per tmux session, one open space with no rooms;
  - a tmux session that holds both workers and independent sessions appears both as a wing and as its own building, and as a wing in each headquarters whose workers run in it;
  - Jira, GitHub, and Confluence are **hubs**, one building each [Quest Board, Forge, Library]; their data source is decided in [Source of SaaS work data](07-source-of-saas-work-data.md).
- **Work item:** the session's linked ledger task; Jira issues, pull requests, and Confluence pages attach to it when linked.
- **Not entities now:** subagents and `pi_exec` workers (they publish nothing); Pi sessions outside tmux; the handoff's Armory, Inn, and Expedition (Town Square became the Slack hub; see the update below).
- **State:** status is `busy`, `idle`, or `waiting`. **Needs you** is waiting, or idle and unseen (the sidebar's rule). A session that leaves the live list leaves the world, with no ghost states. If the feed fails, the whole world shows "disconnected".
- **Truth classes:** observed and decorative only. Inferred labels exist only if [Agent facts shown](06-agent-facts-shown.md) adopts them.
- **Still fog:** several tmux servers, and the operator's avatar in the embodied view.

Update 2026-10-18 from [Source of SaaS work data](07-source-of-saas-work-data.md): Slack is a fourth hub [Town Square].

Update 2026-10-18: the status projection (`busy`/`idle`/`waiting`, needs you) will be replaced by the richer, orthogonal activity dimensions decided in the shared state model task (`.ledger/202610172354-session-state-model/`). The places, relations, and truth classes here stand.

Update 2026-10-18 (operator, after the state model landed): a character outlives its process. A stopped session is a dormant character; reopening wakes the same character, so "leaves the world, with no ghost states" no longer holds. The places above (headquarters, wings, buildings per tmux session) are reopened in [Purpose and form of the world](19-purpose-and-form-of-the-world.md). The work item and the observed relations stand; Agent World stays projection first.

Update 2026-10-18: [Purpose and form of the world](19-purpose-and-form-of-the-world.md) replaced the places above. Places follow functions (headquarters, incoming work, code, knowledge, Slack, mail, dormant agents, independent agents) and reporting, not tmux sessions; what a wing is moved to [What a wing is](21-what-a-wing-is.md).
