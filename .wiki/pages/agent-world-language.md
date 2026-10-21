# Agent World

Agent World is a themeable world that shows the operator's live Pi sessions in tmux as characters in places. All meaningful action happens through tmux and Pi; Jira, GitHub, Confluence, and Slack supplement the world. Terms here are theme-neutral; each theme gives them its own names (fantasy names in brackets).

## Language

### Inhabitants

**Character**:
One top-level Pi session shown in the world, awake while its session runs and dormant while it is stopped; reopening the session wakes the same character. Its look is cosmetic and carries no meaning.
_Avoid_: Hero, agent sprite, persona

**Dormant**:
A character whose Pi session is stopped. It keeps its identity and history and wakes when the session reopens.
_Avoid_: dead, ghost, offline

**Coordinator**:
A character that manages people: the root of an organization, or a person hired into a managing role [Guildmaster]. In the world the word covers every manager; the catalog's `coordinator` role is one of them.
_Avoid_: Orchard, supervisor, chief of staff

**Worker**:
A character that reports to a coordinator.
_Avoid_: Summon, party member

**Independent session**:
A character that reports to no coordinator.

**Former member**:
A dormant character that retired: it left its organization, with a reason, and sleeps at the inn marked so until a manager calls it back [Left the guild; resigned; graduated].

**Team room**:
A wing of the headquarters that holds one manager under the root and everyone reporting to it, named after the manager.

### Places

**Place**:
A hand-designed location, mostly an interior, that serves one function of the world and is drawn differently by each theme. Places follow functions and reporting, not tmux topology.

**Headquarters**:
The organization's place, one per root: where the operator starts and where the root and the people that report to it are [Guild Hall; office floor; classroom].
_Avoid_: Coordination hub

**Wing**:
The part of the headquarters for one repository the coordinator's workers work in. It stays once seen, closed while empty; dormant workers rest in the dormant place instead.

**Hub**:
The place for one external system of engineering work: Jira, GitHub, Confluence, or Slack [Quest board room, Forge, Library, Town square]. Slack channels appear as characters in an exterior.

**Connective tissue**:
The exteriors between places: lanes, paths, and grounds where the world is cozy and ambient life reflects real events, such as couriers carrying real mail.

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
