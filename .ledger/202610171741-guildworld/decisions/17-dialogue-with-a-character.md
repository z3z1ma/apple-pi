Type: interrogation
Status: resolved
Blocked by: 16, 18, 20, 22

# Dialogue with a character

## Question

What can the operator do by talking to a character in Agent World, and how does it feel?

The goal is rich interaction so the operator never has to open the terminal unless they want to. Decide what dialogue covers: reading the agent's messages and tool activity, replying, steering a busy agent, answering a blocking questionnaire, interrupting, and starting new work with the coordinator. Decide how it looks (an NPC-style dialogue, a panel, or both, in the stewardship and embodied views), what stays terminal-only, and which channel carries each action, given the facts in [How to drive a running Pi session from outside](16-driving-a-running-pi-session.md).

## Working notes

Operator, 2026-10-18:

- Agents' replies and choices are usually too long for a JRPG dialogue box, so talking to a character opens the full conversation panel directly; the box is only for short barks.
- A busy agent offers three choices: redirect now (steer), tell it after this turn (follow-up), and stop (abort).
- An open questionnaire, with its question, options, and their descriptions, does not fit a dialogue box: it appears as a themed form.

## Answer

Decided with the operator, 2026-10-18.

- **Talking opens a conversation panel,** over the world (visible and dimmed behind), after the avatar walks up; opening it marks the character seen. The JRPG dialogue box is kept only for short lines such as examining something.
- **Header:** the large portrait, whose expression follows the session's state (busy: thinking, asking you: worried, finished: happy), with the name, repository, current ledger task, and what it is doing now.
- **Conversation:** the full transcript rendered as Markdown with code; tool calls folded into one-line entries that open on click; the reply being written streams in at the bottom ([Live reply streaming](20-live-reply-streaming.md)); history loads page by page when scrolling up (the `messages` index plus batched transcript reads).
- **Acting, by state:** idle: **Reply** (talk); busy: **Redirect now** (steer), **Tell it after this** (follow-up), **Stop** (abort); asking you: the open questionnaire as a **themed form** (question, options with their descriptions, free text), sent with the `answer` command, which also closes it in the terminal. **Go to its terminal** (switch tmux to its pane) is always offered.
- **Barks:** short speech bubbles over heads in the world ("Done!", "I have a question") so a character's state reads from a distance.
- **Themed per pack:** a book or ledger in fantasy, a document window in tech, a notebook in the anime school.
- **The coordinator** uses the same panel; how its conversations become visible work is [Coordinator delegation protocol](12-coordinator-delegation-protocol.md).
- **Terminal-only:** other extensions' dialogs (their kind and title show; the panel points to the terminal), slash commands, and editing past messages.
