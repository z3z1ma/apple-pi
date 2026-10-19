Type: prototype
Status: resolved
Blocked by:

# The interface panel

## Question

What always-available interface sits beside the world, so everything the operator needs is a click away without walking?

The operator wants to lean deeper into RuneScape's interface (not its theme): like Old School RuneScape's bottom-right panel of tabs, everything you might need is immediately accessible, and walking is for immersion, not a requirement. Decide what the panel holds (for example every character and its state, threads and work, mail, Slack, places, settings), how its tabs work, what else of RuneScape's interface carries over (minimap, chat area, hover text, right-click menu already adopted), how acting from the panel relates to walking up to a character, and how each theme styles it. This is the stewardship view living inside the world. The operator judges the feel.

Prototype (2026-10-18): round 6 of [prototypes/headquarters/](../prototypes/headquarters/README.md): minimap with orbs, a seven-tab side panel, and an event chatbox in Old School RuneScape's layout; verdict below.

## Answer

Decided with the operator, 2026-10-18, from round 6 of the [headquarters prototype](../prototypes/headquarters/README.md): "a fire starting point"; much polish remains.

- **Old School RuneScape's layout, any theme's style:** the world fills the screen; around it sit a minimap with orbs (top right), a tabbed side panel (bottom right), and a chatbox of world events (bottom left), plus the hover text and right-click menu already adopted.
- **Everything is a click away; walking is for immersion.** Every action on a character (talk, go to, examine, terminal) works from the side panel wherever the avatar is; Go-to travels and walks up for those who want to.
- **Tabs:** Agents (everyone by where they are, dormant ones at the inn), Needs you (questions first, then finished work), Work (agents by ledger task), Mail, Slack (channels with unread counts), Places (travel to any place), Settings.
- **Minimap:** the whole place with dots for agents, townsfolk, and you; clicking walks there. **Orbs:** needs you, working, unread Slack; each opens its tab.
- **Chatbox:** the runtime's events as lines (where you are, what you did, what characters did, mail, Slack), filterable by kind.
- **Polish noted:** collapsible panels, better styling.
