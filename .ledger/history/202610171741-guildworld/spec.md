# Agent World: specification

Written 2026-10-18 from the cleared [map](map.md) of this task. Every decision here comes from a resolved decision ticket in [decisions/](decisions/), from the [headquarters prototype](prototypes/headquarters/README.md) and its per-round verdicts, or from the shared state model in `components/session-state/` (`docs/session-state.md`).

Terms follow the glossary in `.wiki/pages/agent-world-language.md` (character, awake and dormant, coordinator, worker, independent session, place, headquarters, wing). Terms this spec adds: an *incarnation* is one running process of a session (the runtime counts them by generation); a *receipt* is the runtime's report on a command (accepted, delivered, applied, failed); a *bark* is a short speech bubble over a character's head; *townsfolk* are non-agent characters that stand for Slack channels, and the *town crier* is the one who reaches any channel; an *overlay* is a sprite drawn over a painted place for anything that moves, changes, or can be used; *orbs* are the round counters beside the minimap.

Next step: `/skill:to-tickets` cuts this spec into tickets, slice by slice in the milestone order below.

## Problem Statement

The operator runs many Pi agents at once in tmux: a long-lived coordinator session and the workers it starts, plus independent sessions. Knowing who needs him, what each agent is doing, and acting on it means jumping between tmux panes, the sidebar, the dashboard, and the notch, and then leaving the terminal for GitHub, Jira, Confluence, and Slack. Each view is narrow: it shows a few states, and acting still happens in a terminal or a browser tab. Nothing gives him one place, open beside his work all day, where he can see the whole picture at a glance, talk to any agent, answer its questions, redirect or stop it, review the work it produced, and handle the engineering systems around it, without being forced into the terminal. He also wants that place to be cozy, polished, and fun to be in, not another dashboard.

## Solution

Agent World is a desktop app over tmux and Pi: a themeable, hand-painted world in which every real Pi session in tmux is a character. It is a projection of operational reality (the session-state runtime, the ledger, and external systems) with an interface for acting back on it.

The operator starts in the headquarters, an interior drawn by the theme (a guild hall in fantasy, an office floor in tech, a classroom in anime). The coordinator stands there; the agents that report to it work in wings of the headquarters, one wing per repository; independent agents are elsewhere in the world; dormant agents (stopped sessions) sleep at the inn and wake when reopened. Each other function of the world has its own hand-painted place: the forge (GitHub), the quest office (Jira), the library (Confluence), the town square (Slack, whose channels stand there as townsfolk), the inn, and the rookery (mail between agents), all joined by a cozy painted exterior.

Movement and interaction feel like RuneScape: hover shows the default action, left click does it, right click opens every action, and the avatar walks up before acting. Around the world sits a RuneScape-style interface (a minimap with orbs, a tabbed side panel, and a chatbox of world events) from which every action works without walking; walking is for immersion. Talking to a character opens a themed conversation panel with its portrait, the full transcript, a live streaming reply, and actions that depend on its state: reply, redirect, tell it after this turn, stop, or answer its question in a form. In each function place the operator either acts as himself (with confirmation for anything written outside) or delegates to an agent. The terminal and the real tools always stay one click away.

## User Stories

### Seeing the world

1. As the operator, I want Agent World open beside my work all day, so that I can glance at it and know who needs me.
2. As the operator, I want to start in the headquarters, so that the coordinator and the agents working for it are the first thing I see.
3. As the operator, I want each live top-level Pi session in tmux to appear as a character, so that the world reflects what actually runs.
4. As the operator, I want a character to stay the same character across process restarts, so that reopening a session does not create a new one.
5. As the operator, I want a stopped session to be a dormant character sleeping at the inn, so that the world remembers who exists without pretending they are working.
6. As the operator, I want reopening a session to wake the same character, so that its identity and history continue.
7. As the operator, I want the coordinator (a session started with `pi --coordinator`, or one others report to) to stand at its desk in the headquarters, so that I know where to go to plan work.
8. As the operator, I want agents that report to the coordinator to work in the wing of the repository their session works in, so that work on one project gathers in one place.
9. As the operator, I want a repository's wing to stay in the headquarters once it has had an agent, closed up when empty, so that the layout stays familiar.
10. As the operator, I want the headquarters to show its wings as a gallery of doors with each repository's banner, so that many wings fit without the hall growing out of shape.
11. As the operator, I want a wing room that fits its headcount, so that a busy project has room and a quiet one feels cozy.
12. As the operator, I want several agents able to work at one table in a crowded wing, so that rooms have headroom before a bigger painting is needed.
13. As the operator, I want agents working outside any repository to sit in the headquarters' common room, so that they still have a place.
14. As the operator, I want independent agents (reporting to no coordinator) placed somewhere logical and fun outside the headquarters, so that the world feels inhabited.
15. As the operator, I want a working agent to sit and work at its table, so that busy agents read at a glance.
16. As the operator, I want an agent asking me something to stand with a raised hand, so that questions stand out.
17. As the operator, I want a badge over each character showing working, asking you, or finished and unseen, so that state reads from across the room.
18. As the operator, I want characters that need me to say so now and then in a short speech bubble, so that I notice from a distance without opening anything.
19. As the operator, I want each character's look chosen from the theme's set and kept per session, so that I recognise agents over time.
20. As the operator, I want a character's portrait to show an expression that follows its state, so that its mood matches what it is doing.
21. As the operator, I want a session that leaves tmux or ends to leave its place honestly, so that the world never shows fake activity.
22. As the operator, I want the world to show "disconnected" when it loses the runtime, so that I never trust stale state.

### Moving and interacting

23. As the operator, I want to click a spot to walk there along a sensible path, so that moving feels natural.
24. As the operator, I want my avatar to walk in straight runs that keep clear of furniture, so that pathing never feels broken.
25. As the operator, I want clicking on furniture to walk me to the nearest open floor, so that clicks are never wasted.
26. As the operator, I want a new click to change course at once, so that I am never stuck finishing a walk.
27. As the operator, I want the default action of whatever is under the pointer shown at the top left, so that I know what a click will do.
28. As the operator, I want right click to list every action on what is under the pointer, so that I can choose precisely.
29. As the operator, I want the browser's own right-click menu never to appear, so that the game menu is the only menu.
30. As the operator, I want my avatar to walk up to a character or door before acting, so that the world feels physical.
31. As the operator, I want doors and archways to respond only over the door itself, so that walking near a door does not take me through it.
32. As the operator, I want rooms larger than the screen with the view following me, so that places can be rich without shrinking.
33. As the operator, I want to zoom with the wheel, so that I can choose between overview and detail.
34. As the operator, I want to choose my avatar's look from the theme's options and keep it, so that the avatar feels like mine.
35. As the operator, I want things to fidget with in every place (pet the cat, ring the bell, light the candles), so that the world is fun to be in; they never change work.

### The interface around the world

36. As the operator, I want a minimap of the current place with dots for agents, townsfolk, and me, so that I see everyone at once and can click to walk there.
37. As the operator, I want orbs for how many need me, how many are working, and unread Slack messages, so that the big numbers are always visible.
38. As the operator, I want a tabbed side panel listing every character grouped by where it is, so that I can reach anyone without walking.
39. As the operator, I want a Needs you tab with questions first and finished work next, so that I clear what is waiting in order.
40. As the operator, I want a Work tab grouping agents by ledger task, so that I see work rather than processes.
41. As the operator, I want a Mail tab and a Slack tab, so that traffic between agents and channel activity are one click away.
42. As the operator, I want a Places tab that takes me to any place at once, so that travel never slows me down.
43. As the operator, I want to talk to, examine, go to, or open the terminal of any character from the side panel, so that every action works from anywhere.
44. As the operator, I want a chatbox of world events (where I am, what I did, what characters did, mail, Slack) filterable by kind, so that I can follow what happened.
45. As the operator, I want the interface styled by the theme but laid out like Old School RuneScape, so that it is familiar in every theme.

### Talking to a character

46. As the operator, I want talking to a character to open a conversation panel over the dimmed world, so that long replies and choices have room.
47. As the operator, I want the panel to show the character's large portrait, name, repository, ledger task, and what it is doing now, so that I know who and where I am talking to.
48. As the operator, I want the full transcript rendered as Markdown with code, so that agents' real replies read properly.
49. As the operator, I want tool calls folded into one line each that open on click, so that the conversation stays readable.
50. As the operator, I want a reply being written to stream in as it is written, so that I can watch an agent think and work.
51. As the operator, I want earlier history to load as I scroll up, so that long sessions stay fast.
52. As the operator, I want to reply to an idle agent, so that I can give it its next turn.
53. As the operator, I want to redirect a busy agent now, tell it something for after its turn, or stop it, so that I can steer work in progress.
54. As the operator, I want stopping a busy agent to ask me to confirm, so that I do not lose work by accident.
55. As the operator, I want an agent's open question to appear as a themed form with each option's description and a free-text choice, so that I can answer properly without the terminal.
56. As the operator, I want answering the form to close the question in the terminal too, so that the agent continues from either side.
57. As the operator, I want opening a conversation to mark the character seen, so that every view agrees on who still needs me.
58. As the operator, I want Go to its terminal in the panel, so that the real pane is one click away.
59. As the operator, I want dialogs only the terminal can answer to say so and point me to the terminal, so that I am never stuck.
60. As the operator, I want each action's receipt shown, so that I know a command reached the agent and was applied.
61. As the operator, I want the conversation panel styled per theme (a book in fantasy, a document window in tech, a notebook in the anime school), so that it belongs to the world.

### Working with the coordinator

62. As the operator, I want to talk to the coordinator in the same panel, so that planning work is just a conversation.
63. As the operator, I want workers the coordinator starts to appear in the world as they start, so that delegation becomes visible.
64. As the operator, I want workers grouped by the coordinator they report to, without requiring them to belong to a ledger thread, so that the coordinator keeps its freedom.
65. As the operator, I want mail between workers and the coordinator visible as traffic in the world, so that I see who coordinates with whom.
66. As the operator, I want several coordinators each with their own headquarters, so that separate areas of my life stay separate.

### Function places

67. As the operator, I want the forge to show open pull requests involving me or my agents with their CI state, so that I see code work and its health.
68. As the operator, I want to open a pull request's diff in a review page and comment, approve, or request changes as myself, so that I review without leaving the world.
69. As the operator, I want to ask the agent who built a pull request to address the review, or ask the coordinator to get it reviewed, so that I can delegate follow-up.
70. As the operator, I want the quest office to show the Jira issues assigned to me, so that my own work is in front of me.
71. As the operator, I want to search across every Jira issue and read any of them, so that I understand the wider picture.
72. As the operator, I want to comment on or move an issue as myself, or hand it to the coordinator, so that intake becomes work.
73. As the operator, I want the library to search all of Confluence and show what I read recently, so that knowledge is close at hand.
74. As the operator, I want to read a page in a panel or ask an agent to summarise or update it, so that documentation work can be delegated.
75. As the operator, I want each Slack channel with unread messages to stand in the town square as a townsperson, so that conversations live in the world.
76. As the operator, I want the town square bounded so it never gets noisy, so that it stays calm with many channels.
77. As the operator, I want a town crier who can reach any channel, read or unread, so that nothing in Slack is out of reach.
78. As the operator, I want to read a thread and reply as myself, or ask an agent to look into it, so that I can handle Slack either way.
79. As the operator, I want a private talk with an agent never to post to Slack or anywhere outside, so that delegation and publishing never mix.
80. As the operator, I want the inn to list every dormant agent with its last task and let me wake one into a new tmux window, so that stopped work can resume.
81. As the operator, I want to read a dormant agent's last conversation, so that I know what it was doing before I wake it.
82. As the operator, I want the rookery to show recent mail between agents and mail waiting for dormant agents, and let me mail any agent as myself, so that I can follow and join the coordination.
83. As the operator, I want every place to offer Open in the real tool, so that the world never traps me.
84. As the operator, I want every write outside as myself to show exactly what goes where and ask me to confirm, so that nothing is posted by accident.
85. As the operator, I want every outside write logged in the chatbox and in an append-only local record, so that I can see what I did.

### Themes

86. As the operator, I want to switch between the fantasy, tech office, and anime school themes in Settings, so that I can live in the world I like.
87. As the operator, I want switching themes to change only presentation, so that the same characters, states, and actions remain.
88. As the operator, I want a broken theme pack to fail safely, so that the world still opens.
89. As a theme author, I want one documented pack format (a manifest with labels and interface style, hand-painted places with a shared data format, character sheets and portraits in shared conventions, and overlays), so that a new theme is a set of files, not code.
90. As a theme author, I want a pack check that reports missing required pieces, wrong sprite layouts, and walk-grid mistakes, so that I find problems before the operator does.
91. As a theme author, I want the art pipeline (generation prompts, cutting, quantizing) as repeatable tooling, so that new places and characters keep one standard.

### Reliability and trust

92. As the operator, I want Agent World to read the session-state database and send commands only through the runtime's socket, so that it never becomes a second writer of operational state.
93. As the operator, I want closing Agent World to change nothing in tmux or Pi, so that the world is safe to close.
94. As the operator, I want credentials for GitHub, Jira, Confluence, and Slack kept in the backend and a private file, never in the world UI, themes, or logs, so that secrets stay safe.
95. As the operator, I want Electron installed on Agent World's first launch rather than with apple-pi, so that users who never open it do not download it.

## Implementation Decisions

### Product shape and placement

- **Name and place:** Agent World in prose, `agent-world` in code and paths; a top-level `apps/agent-world/` inside apple-pi, holding backend source, world UI source, the committed built UI, and themes. One package, no workspaces; `apps/` joins the package `files`, `tsconfig.json`, `vitest.config.ts`, and the Biome paths; `AGENTS.md` gains an architecture-map row ([Where Agent World lives and ships](decisions/03-where-guildworld-lives-and-ships.md)).
- **Shipping:** source, the built UI committed like `components/browser-pages/dist/`, and cleaned theme art; raw art and generation inputs stay in the repository only.
- **Shell and stack:** Electron, installed on first launch rather than as an apple-pi dependency; a Node/TypeScript backend; Phaser 4 for the world; React for the conversation panel, interface, and other HTML overlays; Vite building the world UI into a committed bundle ([Shell and service runtime](decisions/08-shell-and-service-runtime.md); `docs/adr/0001-agent-world-runtime.md`).
- **Backend placement:** the backend runs in Electron's main process. It reads the session-state database, talks to the runtime socket, holds all credentials, and makes every external write. The world UI reaches it only through a narrow, typed preload API; there is no network listener in the desktop app. Browser mode, later, reuses the browser-pages pattern (loopback, a token minted at each launch, Host and Origin checks) ([Local API access control](decisions/11-local-api-access-control.md)).

### Truth and ownership

- **Projection first:** Agent World owns no quests, parties, or interaction records; work comes from ledger tasks and linked external items, and groupings are derived. Its only own state is presentation: remembered wings and their order, the chosen theme, and the chosen avatar look, stored as session-state preferences through the runtime's `set_preference` command, plus the append-only local record of outside writes ([What Agent World abstracts](decisions/05-world-ontology-and-truth.md) and its updates; map Notes).
- **Operational truth is the session-state runtime:** sessions, incarnations (generation, pid), tmux bindings, run state, current tool, prompt, model, context, cost, `reports_to`, `spawned_by`, git context, current ledger task, attention (`seen_at`, `settled_at`, `needs_you_since`), the conversation index, and the event sequence. Agent World reads the database directly (read-only, opened query-only as the sidebar does) and changes it only through socket commands with receipts (`docs/session-state.md`).
- **Characters:** a character is a top-level (root) Pi session; awake while its incarnation is alive, dormant while stopped. Child sessions (subagents) and `pi_exec` workers are not characters. A coordinator is a session started with `--coordinator` or one other sessions report to; a worker reports to a coordinator; every other session is independent.
- **Attention:** needs you means an open prompt or an unseen settle (`needs_you_since`); opening a character's conversation sends `mark_seen`.
- **No inferred labels:** the world shows observed facts; animation may follow the observed last tool decoratively ([Agent facts shown](decisions/06-agent-facts-shown.md)).

### Backend modules

- **Runtime reader:** builds the world snapshot from the database and turns new rows in the event table (by sequence) into updates; detects a lost runtime and reports "disconnected".
- **World projection:** places and who is in them: the coordinator in the headquarters; its awake agents in the wing of their repository; agents without a repository in the common room; dormant agents at the inn; independent agents in the exterior; Slack channels as townsfolk. Wings come from the remembered list plus repositories of awake agents, in first-seen order.
- **Command client:** sends session-state commands (`talk`, `steer`, `follow_up`, `abort`, `answer`, `mail`, `start` for waking a dormant agent, `mark_seen`, `set_preference`) over the runtime socket and reports their receipts (accepted, delivered, applied, failed).
- **Conversation reader:** pages a session's history from the `messages` index and reads entries in batches through the runtime.
- **Adapters:** GitHub through the `gh` CLI; Jira and Confluence through their REST APIs with the operator's Atlassian email and API token; Slack through the credential approach settled before the Slack slice. Credentials live in a private `0600` file under `~/.pi/agent/state`. Links are derived from what exists: Jira keys from branch names or ledger tasks, pull requests from branches through `gh`, Confluence pages and Slack threads from URLs in ledger tasks ([Source of SaaS work data](decisions/07-source-of-saas-work-data.md)).
- **Outside-write gate:** every write outside as the operator (PR comment, approval, change request; Jira comment or transition; Slack reply) is confirmed with exactly what goes where, then logged in the chatbox and the append-only local record.
- **Pack loader and check:** loads a theme pack and validates it (below).

### The backend API to the world UI

One typed API carried over Electron IPC through the preload bridge:

- the world snapshot and a stream of updates;
- a character's conversation, page by page, and its live reply stream;
- actions: the commands above, wake, Go to its terminal (switch the operator's tmux client to the character's pane), open in the real tool, place data for each function place, and the gated outside writes;
- settings: theme and avatar look.

### Session-state runtime additions

- **Live reply streaming:** the bridge forwards assistant text deltas from Pi's `message_update` events as a transient message (stream id, sequence, text) that the runtime relays only to clients subscribed to that session, never writing it to `events` or `messages`. Clients subscribe with an explicit handshake, receive per-session filtered streams (children included), and replace the streamed text with the transcript entry named by `turn_end`'s `messageEntryId`. Streams are coalesced or bounded so a slow client cannot back up the bridge ([Live reply streaming](decisions/20-live-reply-streaming.md), [research](research/live-reply-streaming.md)).
- **Batched history reads:** `read_entry` gains a batched or paged form keyed by the ordered ids in the `messages` index, so a long transcript is not scanned once per entry; byte offsets are added only if measurements show the need.

### The world UI

- **Places:** each place is a hand-painted scene per theme, larger than the screen where needed, in a few sizes for what it holds (the wing room comes small and large). Over each painting a data file, authored by hand on a half-tile grid, gives blocked areas, character spots (feet positions on open floor), doors (hotspot, stand point, destination), entries, and named overlay slots. A place that grows repeats a painted section (the gallery repeats one niche per extra wing). Doors and banners are placed sprites; names are drawn as text ([How places are built](decisions/15-how-places-are-built.md)).
- **Paintings follow the sprite and animation patterns:** a painting holds architecture and static decor and leaves out what sprites or overlays provide: no seats at work places (sprites bring their own), open floor around tables and aisles at least a body and a half wide, and empty slots for animation and interactive objects (an empty hearth for an animated fire, a dry basin for animated water, unlit lanterns for glows, bare spots for things to fidget with). Anything that animates, changes with state, or can be interacted with is an overlay in the same style.
- **Exteriors:** hand-painted the same way; one exterior per theme in the first version, its painted building fronts carrying one door per function place; Slack channels stand there as townsfolk ([How exteriors are built](decisions/24-how-exteriors-are-built.md), [Avatar, exteriors, and fidget objects](decisions/27-avatar-exteriors-and-fidget-objects.md)).
- **Characters:** one 16-frame sheet per look: walking down, up, and left in a four-phase cycle (contact, passing with a lifted knee, contact, passing; right is left mirrored), sitting at work from behind (two frames, seat included), standing, and asking with a raised hand. Frames are cut on their magenta gaps, scaled to one standing height (120 px, drawn 1.8 tiles tall at 48 px tiles), set on one baseline, with a soft shadow. Each look has four painted portrait expressions (neutral, happy, thinking, worried) ([Characters and portraits](decisions/22-characters-and-portraits.md)).
- **Movement:** an A* path on a walk grid twice as fine as the tiles, straightened into direct runs that keep a body's width from furniture, walked continuously and ending where the operator clicked; a click on furniture walks to the nearest open floor; a new click retargets. Interaction follows RuneScape: hover text, left-click default, right-click menu, walk up then act ([Movement and pathing](decisions/23-movement-and-pathing.md)).
- **Interface:** Old School RuneScape's layout in each theme's style: a minimap (the whole place, dots for agents, townsfolk, and the avatar; clicking walks) with orbs (needs you, working, unread Slack); a tabbed side panel (Agents, Needs you, Work, Mail, Slack, Places, Settings) from which every action on a character works anywhere; and a chatbox of world events filterable by kind ([The interface panel](decisions/26-the-interface-panel.md)).
- **Conversation panel:** opens over the dimmed world; portrait and header on one side; the Markdown transcript with folded tool calls, the streaming reply, and history paging on the other; actions by state (idle: Reply; busy: Redirect now, Tell it after this, Stop; asking: the questionnaire form); Go to its terminal always. Barks are short speech bubbles in the world. The small dialogue box remains only for short lines such as examining ([Dialogue with a character](decisions/17-dialogue-with-a-character.md)).

### Commands and guards

| Class | Actions | Guard |
| --- | --- | --- |
| In the world | Walk, travel, open panels and tabs, examine, zoom, change theme, mark seen | None |
| Reading outside | Open a PR, issue, page, or thread; search Jira, Confluence, Slack | None |
| Instructing an agent | Reply (talk), redirect (steer), tell it after this (follow-up), answer its question, mail it, delegate | None beyond the command receipt, shown in the chatbox and the panel |
| Interrupting or ending | Stop a running turn (abort), close a session | Confirm when the agent is busy; none when idle |
| Waking | Reopen a dormant session in a new tmux window | None |
| Writing outside as yourself | Comment on, approve, or request changes on a PR; comment on or move a Jira issue; reply in Slack | Always confirm, showing exactly what goes where; log in the chatbox and the append-only local record |
| Leaving the world | Go to its terminal, open in the real tool | None |

([Command vocabulary and gates](decisions/13-command-vocabulary-and-gates.md).)

### Function places

| Place | Shows | As yourself | Delegate |
| --- | --- | --- | --- |
| Forge (GitHub) | Open PRs involving you or your agents on workbenches; CI state (passing, failing, running), shown as the forge's quench | Open the diff in a review page; comment, approve, request changes | Ask the agent who built it (from its branch or worktree) to address the review, or ask the coordinator to get it reviewed |
| Quest office (Jira) | Issues assigned to you (no sprint); search across every issue | Read, comment, move an issue | Hand an issue to the coordinator |
| Library (Confluence) | Broad search across all of Confluence; pages read recently | Read a page in a panel, open it in the browser | Ask an agent to summarise or update a page |
| Town square (Slack) | One townsperson per channel with unread messages, bounded so the square stays calm; the town crier reaches any channel | Read a thread, reply as yourself | Ask an agent to look into a thread |
| Inn (dormant agents) | Sleeping agents; the innkeeper lists each with its last task | Wake one (reopen in a new tmux window); read its last conversation | Ask the coordinator to wake one and give it work |
| Rookery (mail) | Recent mail between agents; mail waiting for dormant agents | Read the traffic; mail any agent as yourself | |

Every place offers Open in the real tool. The town square's bound and scaling are designed with the Slack slice as a deliberate choice, not a constant picked in advance ([What you do in each function place](decisions/25-what-you-do-in-each-function-place.md)).

### Delegation

No protocol of its own: the operator talks to the coordinator in the panel; the coordinator starts, reopens, and closes workers with its lifecycle tools; the world observes the outcome (new sessions, their ledger tasks, mail, the coordinator's replies). A worker need not belong to a coordinator thread; any thread link is derived, never required ([Coordinator delegation protocol](decisions/12-coordinator-delegation-protocol.md)).

### Theme packs

- A pack is a directory with a manifest (theme id and name; labels for every place and role, such as Guild hall / Office floor / Classroom and Guildmaster / Lead / Class rep; style tokens for the interface frame and the conversation panel) and one folder per kind of asset.
- **Places:** every function place hand-designed for the theme (the headquarters and wing rooms in at least two sizes; forge, quest office, library, inn, rookery; at least one exterior with a door per place), each with its painting(s) and data file.
- **Characters:** looks as 16-frame sheets with four portraits each; townsfolk looks; a few avatar looks.
- **Overlays:** doors (open, closed, boarded), banners, animated fire and water, glows, fidget objects.
- **Shared by every pack:** the list of places, the place data format, the sprite frame layout, standing height, and tile size, the four portrait expressions, and the overlay slot types. Geometry is not shared.
- **Required versus optional:** every place, both headquarters sizes, the character and portrait set, doors and banners, and the interface skin are required, and a pack without them fails validation; extra room sizes, ambient animation, and fidget objects are optional.
- **Pack check:** required files present; sprite sheets in the expected frame layout; grids inside their paintings; entries, stand points, and spots on open floor.
- **First packs:** fantasy as the flagship; tech office and anime school as thin packs with the required minimum ([Theme pack contract](decisions/14-theme-pack-contract.md)).

The place data file, as the prototype authored it (coordinates in tiles, fractions allowed; trimmed to the decision-rich shape):

```ts
// From the headquarters prototype (src/places.js).
interface PlaceData {
	cols: number; rows: number;                 // in 48 px tiles
	blocked: [x: number, y: number, w: number, h: number][]; // traced on a half-tile grid
	spots: [x: number, y: number][];            // feet positions on open floor
	entries: Record<string, [x: number, y: number]>;        // keyed by where you come from
	doors: { name: string; rect: [number, number, number, number]; standAt: [number, number]; to: string }[];
	overlaySlots: { kind: "fire" | "water" | "glow" | "banner" | "fidget"; at: [number, number] }[];
}
```

### Art pipeline

Codex's image tool generates scenes and sheets (the operator rates it above other generators). Scene prompts describe the room on a tile grid with a person's height in tiles so scale comes out usable, and state what to leave empty; sheet prompts spell out each frame's pose and walk phase and say when a seat is or is not drawn. Sprites are cut from a magenta background with a wide colour key so no purple fringe remains; scenes and sheets are quantized to 256 colours. Raw art stays in the repository; cleaned art ships.

### Milestones

| Slice | What you get | Done when |
| --- | --- | --- |
| 1. The living headquarters | The art bible and art pipeline (moved here from slice 3 so final art starts at once); real sessions read-only: the fantasy hall, gallery, wings, and square; awake agents in their places, dormant ones absent; movement; the interface with real events; barks; the conversation panel with real transcripts; Go to its terminal | Real sessions appear in the right places within a second, their states match the sidebar, and closing the app changes nothing |
| 2. Talking for real | Panel actions wired to commands; live reply streaming; the inn and the rookery | A whole day of work with agents without opening the terminal |
| 3. Theme proof | Pack format and check; thin tech office and anime school packs; theme switching | Switching themes changes only presentation; a broken pack fails safely |
| 4. The forge | PRs and CI; review page; gated writes; delegation to the PR's agent | Real PRs show; one real review from inside the world |
| 5. Quest office and library | Your issues and issue search; gated Jira writes; Confluence search and reading; delegation | One real issue handed to the coordinator and one page found from inside the world |
| 6. Town square | Unread channels as townsfolk, bounded; the crier; reading and gated replies; delegation; the Slack credential question settled first | A real thread read and answered from the square |
| 7. Polish | Fidget objects; collapsible panels and styling; drawn water and better walk cycles; the noted nits; first-run Electron install; performance | The operator's polish verdict |

([Milestones](decisions/28-milestones.md).)

## Testing Decisions

- **What makes a good test:** it checks behaviour the operator or a theme author can observe (who stands where, what state shows, which command a click sends and its receipt, what a pack check reports, what the screen shows), not internal structure. Tests run against real collaborators where cheap (a real session-state runtime, real faux Pi sessions) and fixtures only at the edges (external services, the world UI's backend).
- **Confirmed seams (2026-10-18):**
  1. **The backend API, over a real session-state runtime:** call the API in Node without Electron against a runtime started in a temporary state directory, with faux Pi sessions and fake bridges driving state. Covers the world projection (characters, places, wings remembered once seen, the inn, the common room, independents, townsfolk), attention and mark seen, actions becoming commands with receipts, confirmations and the outside-write record, conversation paging, the pack check (good and broken fixture packs), and the adapters against local fake servers.
  2. **The world UI in headless Chrome against a fixture backend:** the built UI with the preload API replaced by fixtures, driven by Playwright. Covers walking and pathing over traced grids, doors and travel, the interface (minimap, tabs, orbs, chatbox), the conversation panel with its actions and form, and theme switching changing only presentation.
  3. **The existing session-state runtime tests:** extend `components/session-state/tests` for live reply streaming to subscribed clients and for batched or paged transcript reads.
- **Prior art:** `components/session-state/tests/helpers.ts` (`tempStateDir`, `startRuntime`, `fakeBridge`, `sendCommand`) and its suites; the sidebar's pytest fixture that builds its database with the runtime's own migrations (`components/tmux-sessions/sidebar/tests/conftest.py`); the notch's `--feed-once` test over a fixture database (`components/tmux-sessions/tests/notch-feed.test.ts`); faux Pi sessions (`tests/helpers/faux-session.ts`); the browser-pages built-bundle test; the headquarters prototype's headless Chrome checks.
- **Not a seam:** Electron's own window and packaging get one start-up check in the polish slice.
- A later TDD invocation confirms its own seams before writing tests.

## Out of Scope

Deferred past the first version (logged on the map): a character identity separate from its Pi session, `soul.md`, and memories; world-owned state (quests, parties, interactions) beyond projections; Slack access through an officially scoped token (needed before the Slack slice, settled then); several tmux servers in one world; browser mode and whether browser clients may control agents; accessibility, reduced motion, audio, and the performance budget; first run without Pi, Jira, or GitHub (demo world and onboarding); a serious mode for incidents.

Not wanted: rewards and celebrations; multiplayer, cloud hosting, distributed agent hosts, AI-generated personalities, executable theme mods, marketplaces, true 3D, VR, combat, productivity-tied rewards, mobile; automatic remote writes without the operator's confirmation; any change to the notch panel; the handoff's Armory and Expedition; a separate orchestrator service (the coordinator session is the orchestrator); live pane mirroring in the inspector.

## Further Notes

- **Polish:** the UI and UX are everything (operator, 2026-10-18). The world's mechanics, feel, art, and interface must come together as one experience, and the prototype, though valuable, is nowhere near the final state; it is the baseline to beat. A user-visible ticket is judged on captured screenshots and a short recording against the art bible and the prototype's verdicts, not on passing tests alone, and each slice ends in a polish pass the operator signs off.
- **Starting Agent World:** a `/world` command in root Pi sessions opens it, installing Electron on first use (the simplest launch; set when the tickets were cut, since [Service lifetime](decisions/09-service-lifetime.md) went out of scope unanswered).
- The operator expects much polish across every part; each resolved ticket records its known nits (characters and portraits, movement and pathing, exteriors, the interface panel), and slice 7 is where they are addressed.
- Governing sources: the [map](map.md) and its [decisions](decisions/); the [headquarters prototype](prototypes/headquarters/README.md) with per-round verdicts; `docs/session-state.md` and `components/session-state/` for the runtime; `docs/adr/0001-agent-world-runtime.md`; the domain language in `.wiki/pages/agent-world-language.md`; the owner's handoff in [source/](source/) (non-authoritative where decisions differ) and the [architecture assessment](source/2026-10-18-architecture-assessment.md) (non-authoritative).
- The shared state model was built first as its own task (`.ledger/history/202610172354-session-state-model/`); Agent World depends on it and on its two additions above.
