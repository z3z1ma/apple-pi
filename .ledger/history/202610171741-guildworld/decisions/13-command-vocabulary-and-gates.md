Type: interrogation
Status: resolved
Blocked by: 05, 12, 17, 18, 25, 26

# Command vocabulary and gates

## Question

Which commands does Agent World offer, and what gate guards each?

Most actions on a character come from [Dialogue with a character](17-dialogue-with-a-character.md); this ticket classifies and gates them together with the rest. Take the handoff's verbs (`inspect`, `ask`, `assign`, `form_party`, `open_tmux`, `open_review`, `change_theme`, and others), keep only those with a real effect, classify each as local presentation, read-only external, local process mutation, or remote mutation, and decide the confirmation and audit each class needs. Include how `open_review` reaches the existing review pages.

## Answer

Decided with the operator, 2026-10-18.

| Class | Actions | Guard |
| --- | --- | --- |
| In the world | Walk, travel, open panels and tabs, examine, zoom, change theme, mark seen | None |
| Reading outside | Open a PR, issue, page, or thread; search Jira, Confluence, Slack | None |
| Instructing an agent | Reply (talk), redirect (steer), tell it after this (follow-up), answer its question, mail it, delegate | None beyond the command receipt, shown in the chatbox and the panel |
| Interrupting or ending | Stop a running turn (abort), close a session | Confirm when the agent is busy; none when idle |
| Waking | Reopen a dormant session in a new tmux window | None |
| Writing outside as yourself | Comment on, approve, or request changes on a PR; comment on or move a Jira issue; reply in Slack | Always confirm, showing exactly what goes where; each write is logged in the chatbox and in an append-only local record |
| Leaving the world | Go to its terminal, open in the real tool | None |

The handoff's verbs: `inspect` is Examine, `ask` is Talk, `assign` is delegating (talk or mail to the coordinator or an agent), `form_party` is not a command (the coordinator forms groups), `open_tmux` is Go to its terminal, `open_review` is the forge's review page, and `change_theme` is a setting.
