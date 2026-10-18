Type: interrogation
Status: resolved
Blocked by: 01, 05

# Source of SaaS work data

## Question

Where does Agent World get Jira, GitHub, Slack, and Confluence data?

Decide first whether Slack belongs in Agent World at all: the operator's first-principles statement names only Jira, GitHub, and Confluence as supplements.

Options: its own connectors with their own credentials; data that Pi sessions already reach through MCP and `gh`, relayed through a coordinator or a Pi tool; or coordinator ledger threads as the work-intake source. Decide the source per provider, who holds credentials, and whether remote writes are ever in scope.

## Answer

Decided with the operator, 2026-10-18.

- **GitHub:** the `gh` CLI with its own sign-in (signed in on this machine; JSON output).
- **Jira and Confluence:** their REST APIs with the operator's Atlassian email and an API token. The operator judged `acli` unfit, although version 1.3.21 is installed, signed in, and lists `confluence page` commands.
- **Slack:** in scope. The operator signs in through a browser; Agent World captures the session token and cookie and calls Slack's API as the operator. These are full user credentials, and some workspaces forbid them.
- **Secrets:** a private `0600` file under `~/.pi/agent/state`; never in the frontend, themes, or logs.
- **Hubs:** four, one building each: Jira, GitHub, Confluence, and Slack [Quest Board, Forge, Library, Town Square]. Each shows the items attached to live work items plus the operator's queue (issues assigned to them, PRs awaiting their review, Slack mentions, DMs, and threads).
- **Linking, derived from what exists:** Jira keys from the branch name or the ledger task; the PR from the branch through `gh`; Confluence pages and Slack threads from URLs in the ledger task. Example observed today: worktree `DATA-16969`, branch `DATA-16969`, PR #3712 with 44 checks.
- **Writes:** Agent World writes to any hub only as an explicit, gated action by the operator (for example a Slack reply, a Jira comment, or a PR review). Agents make their own changes through Pi. The gates belong to [Command vocabulary and gates](13-command-vocabulary-and-gates.md).
- **Consequence for the shell:** the shell must support a Slack browser sign-in whose cookies the backend can capture; see [Shell and service runtime](08-shell-and-service-runtime.md).
