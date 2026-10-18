Type: research
Status: resolved
Blocked by: 

# What a Pi extension can observe and control

## Question

What can an extension running inside a Pi session (Pi 1.3.0, `@earendil-works/pi-coding-agent`) observe and do, as raw material for a bridge between each session and a local runtime?

Catalogue, with sources: every extension event and its payload (session start, switch, fork, resume, reload, shutdown; agent start, settle, abort; turn and message lifecycle including streaming deltas; tool call start, update, and end; provider stream events; UI prompt start and end, and the prompt's content; compaction; usage; queue changes); every method that acts on the session (`sendUserMessage`, `sendMessage` with steer, follow-up, and trigger options; abort; reading messages and session state; `appendEntry`; `pi.events`); whether an extension can answer or cancel an open extension UI prompt such as `ask_user_question` from code; and what apple-pi's own components already emit or could expose (subagent child sessions and their parent, `pi_exec` workers, forked continuations, mailbox delivery and recording). Note which facts are only visible inside the session.

## Answer

Findings: [Pi extension surface](../research/pi-extension-surface.md).

- An in-session extension sees almost everything live: session lifecycle (start with reason, switch, fork, tree moves, shutdown with reason), agent and turn lifecycle with outcome, streaming message updates, tool calls with arguments, progress, results, and duration (nested calls included through `parentToolCallId`), input source, model and thinking changes, compaction, context usage, and pending messages.
- It can send user messages and custom messages as steer, follow-up, or next turn; abort the run; append entries; and read the session's entries, tree, header (`parentSession`), and name.
- Limits: UI prompt events carry only kind and title (questionnaire content is visible as `ask_user_question` tool arguments); no API answers another extension's open dialog, so answering from outside needs a change in `ask_user_question`; retries and extension errors are not `pi.on` events; subagent and `pi_exec` worker events are not forwarded to the parent.
