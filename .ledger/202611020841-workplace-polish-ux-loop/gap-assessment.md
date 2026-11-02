# Gap assessment: Chat and the front desk against the best agent workspace

Written after rounds 1-11 (`rounds.md`). The bar is not Slack itself but Slack's interaction quality applied to a team of agents, where the scarce resource is the operator's attention, not typing speed.

## Where Chat stands now

Closed in this loop (all live in Agent World):

| Area | Now |
|---|---|
| Message actions | Hover bar and right-click on every DM, channel and thread message: Reply (quoted, selection-aware), Forward (to several people, channels or threads at once), Ask the front desk to handle, Save for later, Copy, Pin, Copy reference |
| Addressing | @mentions in channels and the desk notify the people named; prose names stay text |
| Navigation | Cmd-K from a top-bar field; Alt + Up/Down through conversations; Alt + Shift + Up/Down through unread ones |
| Attention | Shift + Escape marks everything read; Later view; drafts kept per conversation with a pencil in the sidebar; Mail splits People from Pi's notices |
| Chrome | One header row everywhere; quiet counts (only unread is a badge); one primary colour; keycap hints; full-width tool and thought lines |
| Front desk | Coordinator role now sweeps Slack every 15 minutes, briefs each morning and watches repositories (takes effect when it next starts; unproven live) |

## The remaining delta, ranked by attention saved

1. **Answer without opening the conversation.** A question or approval in Activity should be answerable right there (the questionnaire form inline, Enter to send, J/K to move). Today it opens the agent's DM: three steps and a context switch per question.
2. **Search messages from Cmd-K.** The switcher finds people, channels and threads by name only. "Where did someone say the webhook secret lives?" needs message search across DMs, channels and threads in the same field.
3. **Slash commands in the composer.** `/assign Iris …`, `/remind 3pm …`, `/status`, `/hire …` turn the desk composer into a command line for the organization, without leaving the keyboard.
4. **Reply in thread on the desk.** When the coordinator turns a desk message into a task, replying under that message should continue the task's thread (Slack threads), instead of quoting into the desk. The runtime already links posts and tasks; the UI does not show the link.
5. **Notification policy.** Per conversation: all, mentions only, mute; plus macOS notifications for "needs you" only. Today every unread counts equally.
6. **Recall a message before it is read.** An instruction queued for a busy agent cannot be edited or withdrawn. Slack lets you edit; for agents, withdrawing before delivery is the useful half.
7. **Lightweight acknowledgments.** A reaction (approve, seen, done) instead of a typed "ok" that wakes an agent for nothing.
8. **Status at a glance for many agents.** Stuck, blocked, waiting on you, idle too long, as a sorted list or sidebar state, owned by the watchdog role; today only working / idle / away.
9. **Offline composing.** While the runtime is disconnected the whole surface is inert; writing should continue and send on reconnect.
10. **Scale.** Threads (590) and the people table render every row; at a few thousand they will need windowing.

## Decisions only the operator can make

- **What Enter does while an agent is working.** Today Enter redirects it at once (interrupts); "Tell it after this" queues. Slack's instinct is that sending never interrupts. Options: keep Enter = redirect; make Enter = queue and Cmd + Enter = redirect.
- **Threads as channels.** Task threads stay a list in Threads with a side panel. Making every task thread a sidebar channel is Slack-like but floods the sidebar at 30+ in flight; the alternative is "Threads" as Slack's own Threads view (current) plus item 4.
- **Coordinator's Slack reach.** The sweep reads DMs, mentions and his threads. Should it also read channels he is in but not mentioned in (more noise, more catches)?
