Type: interrogation
Status: resolved
Blocked by:

# What you do in each function place

## Question

What does the operator do in each function place, and what does each place show?

The places are decided in [Purpose and form of the world](19-purpose-and-form-of-the-world.md): the forge (GitHub: pull requests, reviews, CI), the quest office (Jira: incoming work), the library (Confluence: knowledge), the town square (Slack channels as townsfolk), the inn (dormant agents), and the rookery (mail between agents). For each, decide the actions: acting as yourself (writes only as explicit, gated operator actions, per [Source of SaaS work data](07-source-of-saas-work-data.md)) versus delegating to an agent (see the [architecture assessment](../source/2026-10-18-architecture-assessment.md)), what the place shows of live data, and how it opens into its real tool. Include the forge's review flow and how a review page opens, and the town square's scale: the operator's idea is one townsperson per Slack channel with unread messages plus a town crier who can look into any channel, read or unread.

## Answer

Decided with the operator, 2026-10-18, as the first version's contract; layout and exact panels come with each place's build. Everywhere the operator either acts as himself (explicit, confirmed writes) or delegates to an agent (into its session); a private talk with an agent never posts outside. Every place offers **Open in the real tool** in the browser.

| Place | Shows | As yourself | Delegate |
| --- | --- | --- | --- |
| **Forge** (GitHub) | Open PRs involving you or your agents, each a piece on a workbench, CI as the quench (passing, failing, running) | Open the diff in a review page; comment, approve, request changes | Ask the agent who built it (found from its branch or worktree) to address the review, or ask the coordinator to get it reviewed |
| **Quest office** (Jira) | Issues assigned to you on a board (no sprint), with a clerk; search across every issue to read any of them and understand the wider picture | Read, comment, move an issue to another status | Hand an issue to the coordinator, which starts work on it |
| **Library** (Confluence) | Broad search across all of Confluence through a librarian; pages read recently on shelves | Read a page in a panel, open it in the browser | Ask an agent to summarize or update a page |
| **Town square** (Slack) | One townsperson per channel with unread messages, bounded so the square stays calm; the town crier reaches any channel, read or unread | Read a thread, reply as yourself | Ask an agent to look into a thread |
| **Inn** (dormant agents) | Sleeping agents in their rooms; the innkeeper lists everyone dormant with their last task | Wake one (reopen its session in a new tmux window), read its last conversation | Ask the coordinator to wake one and give it work |
| **Rookery** (mail) | Ravens with recent mail between agents, plus mail waiting for dormant agents | Read the traffic; send mail to any agent as yourself | |

- **The square must not get noisy:** how many townsfolk stand there at once and how the square scales with many channels is designed with the Slack build; the bound is a deliberate design choice, not a constant picked now.
- The operator expects tender care across every place; this table is the contract, not the finish.
