# Agent World

Agent World is a themeable world that shows the operator's live Pi sessions in tmux as characters in places. All meaningful action happens through tmux and Pi; Jira, GitHub, Confluence, and Slack supplement the world. Terms here are theme-neutral; each theme gives them its own names (fantasy names in brackets).

## Language

### Inhabitants

**Character**:
One live root Pi session running in tmux, shown in the world. Its look is cosmetic and carries no meaning.
_Avoid_: Hero, agent sprite, persona

**Coordinator**:
A character whose session keeps the operator's threads and supervises workers; the operator names which sessions these are [Guildmaster].
_Avoid_: Orchard, supervisor, chief of staff

**Worker**:
A character that reports to a coordinator.
_Avoid_: Summon, party member

**Independent session**:
A character that reports to no coordinator.

### Places

**Headquarters**:
A coordinator's own themed place, one per coordinator [Guild Hall].
_Avoid_: Coordination hub

**Wing**:
The part of a headquarters that holds that coordinator's workers from one tmux session.

**Building**:
The place that holds the independent sessions of one tmux session; one open space with no rooms.

**Hub**:
The place for one external system of engineering work: Jira, GitHub, Confluence, or Slack [Quest Board, Forge, Library, Town Square].

### Work and state

**Work item**:
The ledger task a character's session is linked to. Jira issues, pull requests, Confluence pages, and Slack threads attach to it when they are linked.
_Avoid_: Quest, assignment

**Needs you**:
A character whose session has an open prompt for the operator, or a new reply since the operator last looked at it.

**Observed**:
Shown because a source record says so, such as a session's status or its last tool call.

**Decorative**:
Shown for atmosphere only, such as motion, poses beyond status, and cosmetics; never a claim about work.
_Avoid_: Inferred (unless a later decision adopts inferred facts)
