Type: interrogation
Status: open
Blocked by: 05, 12, 17, 18

# Command vocabulary and gates

## Question

Which commands does Agent World offer, and what gate guards each?

Most actions on a character come from [Dialogue with a character](17-dialogue-with-a-character.md); this ticket classifies and gates them together with the rest. Take the handoff's verbs (`inspect`, `ask`, `assign`, `form_party`, `open_tmux`, `open_review`, `change_theme`, and others), keep only those with a real effect, classify each as local presentation, read-only external, local process mutation, or remote mutation, and decide the confirmation and audit each class needs. Include how `open_review` reaches the existing review pages.
