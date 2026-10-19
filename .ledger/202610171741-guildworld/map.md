# Agent World map

## Destination

Agent World is a full-screen, themeable world app (web or desktop) over tmux and Pi. Real Pi sessions in tmux appear as characters, and all meaningful action goes through tmux and Pi. Jira, GitHub, Confluence, and Slack supplement the world as the main hubs of engineering work. One world model serves a stewardship view (overview and control) and an optional embodied view (the user walks an avatar).

A whole-product spec for Agent World, ready for `/skill:to-spec`: every architecture, contract, and scope decision the handoff leaves open is settled, and the milestones are ordered as demoable vertical slices.

## Notes

- Source: the owner's handoff in [source/](source/) (`IMPLEMENTATION_HANDOFF.md`, `START_HERE.md`, `approved-storybook-concept.png`). Its "confirmed vision" items are constraints unless the operator has since said otherwise. Its "recommended defaults" were challenged in tickets: the shell and engine are decided ([Shell and service runtime](decisions/08-shell-and-service-runtime.md)), and the local runtime and store moved to the shared state model task (`.ledger/202610172354-session-state-model/`).
- First principles (operator, 2026-10-17, after the Guild Hall art and scale prototype): Agent World is an abstraction primarily over tmux and Pi, and it is tightly bound to them. All meaningful action happens through tmux and Pi. Jira, GitHub, and Confluence supplement the world. This framing comes before every other decision; the handoff gave detail that ran ahead of it.
- Roles: only the coordinator is settled: the session that runs the `coordinator` skill. It is called the Guildmaster in the fantasy theme and named differently elsewhere. All Pi sessions are otherwise much the same. The subagent types a session can call (builder, designer, and others) are separate from any world role. The handoff's personas (Sage, Artificer, Sentinel, Scribe, Scout) are not adopted.
- Foundation first (operator, 2026-10-18): a maximally rich, solid state model of Pi, tmux, and processes comes before any more world design, and it serves all of apple-pi, not only Agent World. It lives in its own ledger task, `.ledger/202610172354-session-state-model/`; Agent World is a projection of that state plus an interface for sending actions back. Capture is a bridge extension in every Pi session; the store is SQLite with current-state tables and an append-only event table. No separate deterministic orchestrator service: the coordinator session remains the orchestrator.
- World prototypes so far missed the vision: the Guild Hall copied the notch, and the town had "no personality". The state model has landed and the world's purpose and form are decided ([Purpose and form of the world](decisions/19-purpose-and-form-of-the-world.md)).
- After the state model (operator, 2026-10-18, informed by the non-authoritative [architecture assessment](source/2026-10-18-architecture-assessment.md)): a character outlives its process: a stopped session is a **dormant** character, and reopening wakes the same one. Agent World is **projection first**: work comes from ledger tasks and linked external items, groupings are derived, and the world owns durable state of its own only when a real feature needs it. How places relate to tmux topology is decided together with the world's purpose and form.
- Ambition (operator, 2026-10-18): Agent World should allow rich interaction with characters, including dialogue that uses the agents' own text and lets the operator respond, so the operator need not open the terminal unless they want to. This overrides the handoff's anti-goal "not a replacement for Pi or tmux": the terminal stays available, not required. The notch's few states and narrow purpose set no ceiling.
- The notch has zero influence on Agent World (operator, 2026-10-18). The two share only the observed state (tmux records and session data). Nothing of the notch's experience, art method, room format, pose sheets, or animation vocabulary carries over. The Guild Hall art and scale prototype copied the notch's method and fell far short of the direction; the next prototype must be a drastically different, net-new experience designed from Agent World's own goals.
- Name: the product is Agent World (`agent-world` in code and paths). The handoff calls it Guildworld; Pomona was a short-lived interim name (operator, 2026-10-18).
- Placement differs from the handoff: Agent World lives inside apple-pi, not in a separate repository, and apple-pi and the coordinator skill may change to support it (operator, 2026-10-17, this session). The notch panel's UI, assets, and `notch.json` stay untouched and uncoupled, as the handoff requires.
- The world never invents state: `busy`/`idle`/`waiting` are the only observed agent statuses today; settled is not done; sent is not acknowledged.
- Skills: `interrogate-to-design` and `domain-modeling` for interrogation tickets, `prototype` for the art ticket, `research` for research tickets. Record resolved terms in `.wiki/pages/agent-world-language.md`.
- No execution scope is approved. This map produces decisions only.

## Decisions so far

- [Apple-pi integration inventory](decisions/01-apple-pi-integration-inventory.md): Agent World can read live agents, last tool, ledger task, and cost per tmux server and can send mailbox messages; there is no acknowledgement, no non-Pi mailbox, no cross-server feed, and SaaS access lives only inside Pi via MCP.
- [Desktop shell packaging facts](decisions/02-desktop-shell-packaging-facts.md): Tauri needs Rust + Xcode CLT + Node on the user's machine to build; a Swift WKWebView shell needs only `swiftc` (notch precedent); a Node-served browser page needs no native toolchain.
- [Where Agent World lives and ships](decisions/03-where-guildworld-lives-and-ships.md): named Agent World; lives in top-level `apps/agent-world/`; ships source, a committed built frontend, and cleaned art in the one Pi package.
- [Guild Hall art and scale](decisions/04-guild-hall-art-and-scale.md): rooms use a 3/4 top-down view at 32 px tiles; status must read without colour alone; generated art is fine for prototypes. Its notch-derived method (one painted room, pose sheets, baked glyphs) was rejected and does not carry forward.
- [What Agent World abstracts in tmux and Pi](decisions/05-world-ontology-and-truth.md): a character is a live root Pi session; coordinators (configured ids) stand in their own headquarters, their workers live in wings per tmux session, independent sessions live in one building per tmux session, and Jira, GitHub, and Confluence are hubs; the work item is the linked ledger task; only observed and decorative facts.
- [Agent facts shown](decisions/06-agent-facts-shown.md): the inspector shows identity, activity, cost, and context, with no live pane view; animation may follow the last tool; no inferred labels; inspecting marks a character seen, shared with tmux; apple-pi publishes nothing new for these facts. Conversation moved to its own ticket.
- [How to drive a running Pi session from outside](decisions/16-driving-a-running-pi-session.md): from outside a TUI session one can read completed messages (JSONL) and send text by mailbox (steer, any status) or `send-keys` (idle only); streaming text, answering a questionnaire, interrupting, and acknowledgement need a new apple-pi per-session channel or RPC-mode sessions.
- [Source of SaaS work data](decisions/07-source-of-saas-work-data.md): GitHub through `gh`; Jira and Confluence through REST with an Atlassian API token; Slack through a captured browser session; secrets in a private file; Slack is a fourth hub; links are derived from branches and ledger tasks; Agent World writes only as explicit gated operator actions.
- [Shell and service runtime](decisions/08-shell-and-service-runtime.md): Electron (installed on first launch), a Node/TypeScript backend, Phaser 4 for the world with React overlays for dialogue and panels, a committed Vite bundle; browser mode later from the same backend.
- [Shared state model spec lands](decisions/18-shared-state-model-spec-lands.md): the shared state model spec and its 16 tickets were approved on 2026-10-18; Agent World reads its database and sends commands over its socket. All 16 tickets were built and closed the same day.
- [Live reply streaming](decisions/20-live-reply-streaming.md): Pi's `message_update` already carries text deltas; add a transient bridge message the runtime relays only to subscribed clients (no events), reconcile with the transcript entry at `turn_end`; page and batch history reads from the `messages` index.
- [Purpose and form of the world](decisions/19-purpose-and-form-of-the-world.md): a home base beside the operator's work; every function has its own hand-designed place (mostly interiors) drawn per theme, joined by cozy exteriors; the operator starts in the headquarters with the coordinator and its agents; places follow functions and reporting, not tmux.
- [Local API access control](decisions/11-local-api-access-control.md): the backend runs in Electron's main process, holds all secrets and external writes, and the renderer reaches it only over typed IPC; no network listener until browser mode, which reuses the browser-pages loopback, per-launch token, and Host/Origin pattern.
- [What a wing is](decisions/21-what-a-wing-is.md): one wing per repository, remembered once seen (closed when empty); dormant agents rest in the dormant place; agents outside any repository use a shared common room.
- [How places are built](decisions/15-how-places-are-built.md): interiors are hand-painted scenes per place and theme in a few sizes, with hand-authored walk grids, spots, and hotspots, and placed sprites for doors and banners; tiled exteriors, the borrowed characters, and the pathing failed and became their own tickets.
- [Characters and portraits](decisions/22-characters-and-portraits.md): HD 16-frame sprite sheets per character with spelled-out walk phases and their own seats; large JRPG portraits with four expressions beside the dialogue box.
- [Movement and pathing](decisions/23-movement-and-pathing.md): RuneScape's interaction rhythm with smooth string-pulled movement over half-tile walk grids traced by hand; paintings leave room to move and interact.

## Not yet specified

- Character identity beyond the session: whether a character id is separate from its Pi session id, and what a `soul.md` and memories are and where they live. Sharpens once the world's purpose and form are known; dormant characters are decided.
- World-owned state: quests, parties, and interactions start as projections (ledger tasks, linked external items, derived groupings); revisit when a feature needs durable world state.
- Slack access: revisit the captured browser session from [Source of SaaS work data](decisions/07-source-of-saas-work-data.md) in favour of an officially scoped token before any Slack build.
- Milestone order and slice boundaries: depends on most tickets; the handoff's M0–M7 is a starting point.
- The operator's avatar: who it is and how it looks; sharpens with [Characters and portraits](decisions/22-characters-and-portraits.md). Movement itself is [Movement and pathing](decisions/23-movement-and-pathing.md).
- Layout of the connective tissue: how the function places are arranged and joined per theme; sharpens with [How exteriors are built](decisions/24-how-exteriors-are-built.md).
- PR review flow in the Forge: how a review page opens from Agent World and what the Forge shows; follows the command and SaaS-source decisions.
- Several tmux servers in one world (each coordinator already gets its own headquarters).
- Browser mode: whether a browser client may control agents or only view them; decided with the browser-mode milestone.
- Accessibility, reduced motion, audio, and the performance budget.
- Things to interact with (the painted/overlaid split is decided in [How places are built](decisions/15-how-places-are-built.md)): many more objects to fidget with in every place ("ADHD paradise"), a polish pass once places, characters, and movement work.
- Rewards and celebration policy, and the serious-mode override for incidents.
- First run without Pi, Jira, or GitHub: the demo world and onboarding.

## Out of scope

- [Service lifetime](decisions/09-service-lifetime.md) and [Persistence](decisions/10-persistence.md): moved to the shared state model task, whose runtime and store Agent World will use.
- Everything the handoff defers: multiplayer, cloud hosting, distributed agent hosts, AI-generated personalities, executable theme mods, marketplaces, true 3D, VR, combat, productivity-tied rewards, mobile, and automatic remote writes without a permission policy.
- Any change to the notch panel's behaviour, art, or state.
- Retention and cleanup of transcripts and state for long-running sessions: an apple-pi operational concern, not a world decision.
- The handoff's Armory and Expedition as places: places follow the world's functions ([Purpose and form of the world](decisions/19-purpose-and-form-of-the-world.md)); the fantasy inn returned as the place of dormant agents.
