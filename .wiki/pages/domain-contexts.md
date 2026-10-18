# Domain Contexts

## Contexts

- [[domain-language|Apple Pi harness]]: the coding-agent environment, its participants, and its durable knowledge.
- [[agent-world-language|Agent World]]: the themeable world that shows live Pi sessions in tmux as characters in places.

## Relationships

- **Agent World → Apple Pi harness**: Agent World observes harness sessions, ledger tasks, and mailboxes and acts only through tmux and Pi. A coordinator is a root session that runs the `coordinator` skill.
