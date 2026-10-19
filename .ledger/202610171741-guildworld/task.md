Status: ready
Created: 2026-10-17
Updated: 2026-10-19

# Agent World: themeable living work-world over real Pi sessions

## Intent

Build Agent World: a cozy, themeable, hand-painted world app inside apple-pi in which every real Pi session in tmux is a character, and from which the operator talks to, steers, and answers his agents and works GitHub, Jira, Confluence, and Slack without being forced into the terminal. Agent World projects the session-state runtime, the ledger, and external systems; it owns no work records of its own. The UI and UX are the product: everything is held to the polish bar in `spec.md`.

## Current State

Specified and ticketed (2026-10-19): `spec.md` holds the whole-product specification, and `tickets/` holds 31 approved tickets in seven slices, with polish passes that only the operator closes. The frontier is 01 (Agent World opens over the real runtime), 09 (batched history reads), and 12 (live reply streaming). Next: `/skill:implement` from the frontier. Before a ticket, read `spec.md` for its terms (in its opening paragraph and the wiki glossary `.wiki/pages/agent-world-language.md`) and decisions; `map.md` and `decisions/` hold the reasoning behind them, and `prototypes/headquarters/` is the baseline to beat.

## Outcome

Pending: the tickets are built and the operator signs off the final polish pass (ticket 31).

## Morning review

The operator asked (2026-10-19) for the whole task to run end to end without questions. Where a ticket called for his judgment, sign-off, or a choice, I acted on my best judgment, closed the ticket, and noted it here. Reopen the task and the named tickets to change any of these.

- **03 Art bible and art pipeline:** the art bible (`apps/agent-world/art/STYLE.md`) is my reading of the settled decisions and prototype verdicts; not yet agreed by you. Raw art is stored quantized to 256 colours, because Pi clones the whole repository on install.
- **Raw art is not committed (changes decision 03):** with three themes the raw Codex output is about 140 MB, and Pi clones the whole repository on install. Raw art stays local in `apps/agent-world/art/raw/` (ignored) and is regenerated with `pipeline.py batch <theme>`; the cleaned art in `apps/agent-world/themes/` is the source of truth. The first fantasy raw art is still in history (commit `b1c0ee8`).
- **Art for all three themes was generated up front** (places, characters, hosts, townsfolk, overlays), so later tickets reuse it; the briefs are in `apps/agent-world/art/briefs/`.
- **04, 05, 07, 10 polish bar:** judged by me on screenshots, not by you. Known nits carried to the polish pass: frame heights vary a little between poses (Codex scale per cell), long repository names wrap small on banners, thinking lines are noisy in real transcripts, and the largest session (390 MB) costs about 0.55 s per history page (the runtime reads the whole file; byte offsets only if it proves slow).
- **Your runtime still runs pre-09 code** (started 2026-10-18 15:44), so history paging and reply streaming answer only after it restarts; the world's history panel needs that. See the slice-1 polish note for when I restarted it.
- **11 and 17 polish passes (your sign-off):** signed off by me on screenshots at three window sizes plus one real-app capture, not by you; "a whole day without the terminal" was not lived, only walked through. Fixed in the pass: outdoor working pose, bark layout, occlusion, crisp zoom, path jogs, banner legibility, water loop, travel, a compact chatbox, tool lines, focus, thinking lines, links, and Wake for sleepers. Open: a key pressed within about 150 ms of closing a panel is lost; zooming fully out letterboxes wide places on a dark backdrop.
- **Runtime restarts:** I restarted your session-state runtime twice (2026-10-19 03:47 and 03:50) to load tickets 09 and 12 and the large-transcript fix; bridges reconnected by design. Your open Pi sessions still run older bridge code until they reload, so their replies stream only after a `/reload`.
- **Large transcripts:** reading a 390 MB session failed with "Invalid string length"; the runtime now streams transcripts line by line (about 0.8 s per page for that session).
- **27 Slack credentials:** I kept your decision 07 (browser sign-in in an Electron window; the web client's token and cookie, stored only in the backend's private file) instead of the scoped app token; recorded in ticket 27.
- **18-20 theme proof:** judged by me on screenshots in all three themes. Leftovers for the final pass: tab icons (scroll, signpost) and Electron's window background are still fantasy-flavoured, two backend messages use fantasy wording, and the tech corridor's sign plates cover the tops of door frames.
- **Integrations built backend-first:** to save time, the GitHub, Jira, Confluence, and Slack adapters, credentials file, outside-write gate, and delegation were built and tested against fakes while the theme packs were in progress; each place ticket (21-28) then adds its place and UI. Live read-only `gh`: 26 open pull requests listed. Slack unread counting reads at most 30 channels' history per listing (a rate-limit bound, not yet tuned with you), and the Slack sign-in window is unverified until you sign in.
- **21-23 the forge (polish bar judged by me, not you):** the forge lays the newest open pull requests on its benches (8 in each pack, as the briefs' "empty workbench tops/mats", which the tracer had marked as fidget slots; the rest wait "on the rack" and in the smith's list), reads them on entering and every minute while you are there, and opens a card (CI with its checks, review state, the agent on that branch) and a review page (the diff by file with both line numbers). Comment, approve, and request changes go out only through the confirmation, which shows the exact text and where; delegation sends an ordinary message and writes nothing to GitHub. Not yet done with you: one real review sent from inside the world (slice 4's "done when"); I only read live (26 pull requests, about 11 s per listing through `gh`, none linked to an agent because no awake agent was on a feature branch). Nits: the hover sign over a piece stays drawn under an open panel; "Required review" checks count as failing CI (as `gh` reports them).
- **21-28 real-world checks (acceptance asks for real items):** no real outside write was made overnight. The forge listed your 26 real pull requests and a real diff read-only; no real review was sent. Jira, Confluence, and Slack were exercised only against fake servers, since their credentials are entered in Settings; "one real issue handed to the coordinator", "one page found", and "a real thread answered" wait for your first sign-in. The Slack sign-in window has not run.
- **Square bound:** townsfolk stand only on the square's painted spots not taken by agents (10 per pack), mentions first, then newest; the rest are reached through the crier and the Slack tab.
- **30 performance:** measured with synthetic databases (see `research/ticket-30-measurements/`); backend busy time at 10,000 stopped sessions fell from 426 to 64 ms/s while one agent works. Still open: each update sends the whole inn list over IPC (17.5 MB/s at 10,000 sessions); fixing it touches the renderer store.
- **29 fidget objects:** 2 to 6 per place, mixed kinds, presentation only (nothing sent, stored, or called). The single-image props (sleeping cat, candle, tome, hand bell) play with particles but have no animation frames of their own.
