## file

Delegation uses the backend API over a real session-state runtime with faux Pi sessions. GitHub, Jira and Slack fakes must see nothing. A follow-up waits until the current run ends, then goes out as the next turn.
Why: sending during the current run would start a second turn instead of steering the existing one.
