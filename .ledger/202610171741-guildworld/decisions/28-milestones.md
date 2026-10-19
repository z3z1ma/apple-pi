Type: interrogation
Status: resolved
Blocked by:

# Milestones

## Question

In what order is Agent World built, as demoable vertical slices, from the first runnable world to the first version?

Every decision on the map is settled; order them into slices that each end in something the operator can use. Take the handoff's M0 to M7 as a starting point only. Decide the first slice (the smallest world that works over the real session-state runtime), where live dialogue and reply streaming land, when the function places and their integrations (GitHub, Jira, Confluence, Slack) arrive, when the thin tech and anime packs prove theme-neutrality, and where the polish passes the operator asked for fall.

## Answer

Decided with the operator, 2026-10-18. Each slice ends in something the operator can use.

| Slice | What you get | Done when |
| --- | --- | --- |
| 1. The living headquarters | The Electron app shows real sessions read-only: the fantasy hall, gallery, wings, and square (prototype art, cleaned up); awake agents in their places, dormant ones absent; smooth movement; the RuneScape interface with the chatbox fed by real runtime events; barks; the conversation panel with real transcripts; Go to its terminal | Real sessions appear in the right places within a second, their states match the sidebar, and closing the app changes nothing |
| 2. Talking for real | The panel's actions wired to runtime commands (reply, redirect, tell it after this, stop with confirmation when busy, the questionnaire form); live reply streaming (the bridge and runtime addition from [Live reply streaming](20-live-reply-streaming.md)); the inn (wake dormant agents) and the rookery (read mail, send as yourself) | A whole day of work with agents without opening the terminal |
| 3. Theme proof | The pack format and pack check; thin tech office and anime school packs; theme switching in Settings; the art pipeline as repeatable tooling | Switching themes changes only presentation; a broken pack fails safely |
| 4. The forge (GitHub) | PRs and CI on workbenches; a review page; comment, approve, request changes as yourself (confirmed and logged); delegate to the agent who built a PR | Real PRs show; one real review from inside the world |
| 5. Quest office and library (Jira, Confluence) | Your issues and search across all issues; comment and move as yourself; Confluence search and reading; delegation | One real issue handed to the coordinator and one page found from inside the world |
| 6. Town square (Slack) | Unread channels as townsfolk, bounded; the town crier for any channel; read and reply as yourself; delegate a thread; the Slack credential question settled first | A real thread read and answered from the square |
| 7. Polish | Fidget objects, collapsible panels and styling, drawn water and better walk cycles, the polish notes recorded in the resolved tickets (characters, movement, exteriors, interface), first-run Electron install, performance | The operator's polish verdict |

Themes come third, not second as in the handoff: the world should feel alive and workable first, and theme proof then catches fantasy-only assumptions before the integrations multiply.
