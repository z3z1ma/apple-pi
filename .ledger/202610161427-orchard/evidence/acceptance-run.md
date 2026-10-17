# Orchard acceptance runs (seam B)

Live runs of a real Orchard session in a scratch tmux server, the second test seam in [spec.md](../spec.md#testing-decisions), checked against the [acceptance criteria](../task.md#acceptance-criteria). To rerun: `acceptance-setup.sh <new directory>` starts Orchard; send prompts with `tmux -L orchard-accept send-keys -t accept:orchard`; tear down with `tmux -L orchard-accept kill-server`. No run so far used the final script, whose wrapper passes `--no-mcp`.

## Run 1

Run on 2026-10-16 with the `orchard` skill as first written, the operator's default model (GPT-6.1 Sol, low thinking), and `acceptance-setup.sh` as it was then: a scratch tmux server (`tmux -L orchard-accept`), scratch `PI_MAILBOX_DIR` and `PI_TMUX_STATE_DIR`, a scratch Orchard home with a test charter (local work only, 3-minute sweeps), and a scratch repository with no remote.

### Isolation: what held and what did not

- Held: mailbox and tmux state records stayed in the scratch directory; no `orchard` files appeared under `~/.pi/agent/state/`.
- **Did not hold: the `pi` wrapper was bypassed.** tmux gives each new pane the PATH of the client that created it, and the pane's shell (fish) put the real `pi` first. So Orchard and its worker ran **with MCP tools available** and wrote their session files to `~/.pi/agent/sessions` instead of the scratch directory.
- Effect checked in both session files afterwards: no `tool_search` call, no MCP tool call, and no `gh`, `curl` or `git push` command. The only matches are the charter's own text. The two scratch session directories were deleted from `~/.pi/agent/sessions`.
- Fixed in `acceptance-setup.sh` before run 2: the first pane gets the wrapper PATH explicitly and the scratch server uses `/bin/sh`; the wrapper sets `PI_CODING_AGENT_SESSION_DIR` (which subagent sessions also honour) and excludes the MCP tools and resource tools; the script refuses an existing scratch directory or a running scratch server. After run 2 the exclusion was replaced with `--no-mcp`.

### Acceptance criteria

1. **Pass.** One dump with three topics became three ledger tasks in the Orchard home: Dana's reply ("by Friday, 16 October 2026 (today)"), the CONTRIBUTING.md work, and the passport ("November, follow-up 1 November"). The repo-work thread names the worker's private repository ledger task, which the worker created under `repo/.ledger`, listed in `.git/info/exclude`.
2. **Pass.** Orchard wrote `briefs/contributing.md`, started `tmux new-window -d -n contributing -c <repo> "pi --session-id orchard-contributing-20261016 --name contributing @<brief>"`, and recorded the id, directory and brief in the thread. The brief ended with the reporting contract.
3. **Pass.** The worker sent a `mailbox_send` to `orchard` when done. Orchard received it as a steer, checked the result itself (reran the documented command, checked whitespace), and summarized it without the operator opening the worker.
4. **Pass.** After the Orchard process was killed and restarted (`respawn-pane -k`, `pi --session-id orchard`), "What is going on with the CONTRIBUTING.md work, and what else do I have open?" was answered from the ledger, including the archived thread and both open threads with their dates.
5. **Pass for dates and rescheduling; stale case not exercised.** The scheduled sweep fired, reviewed the ledger and workers, reported the due Dana reply and the passport follow-up, and scheduled the next sweep. Orchard also scheduled its first sweep right after the dump. Orchard committed its home after each change.

### Deviations, and what changed

- **The finished worker's window was closed during the sweep, before the operator replied.** The skill said "until the operator has seen your summary", and Orchard took showing the summary as seen. The skill now says "until the operator replies to your summary". Verified in run 2.
- **After the restart, Orchard did not load the skill and did not schedule a new sweep.** It answered from the ledger after reading the charter, whose line was "Load and follow the orchard skill." A model-invoked skill cannot make itself load, so the test charter now asks for it before the first reply of every session. Run 2 showed the actual cause differs; see below.

## Run 2

Same date, model and scenario, with the fixed harness, the "replies to your summary" skill wording, and a dump that adds an overdue commitment (Sam's budget numbers, promised for Monday 12 October).

### Isolation

- Both session files were written to the scratch `sessions` directory; nothing appeared under `~/.pi/agent/sessions`, `state/mailbox` or `state/tmux-sessions`.
- Run 2's wrapper excluded MCP tools and resource tools, so the model had no MCP tool, but Pi still connected the configured servers at startup. `--no-mcp`, which keeps every server from connecting, was added after run 2 and checked only by a probe session: it has no `/mcp` command. No end-to-end run used `--no-mcp`.
- In every run, the no-network rule for shell commands (`curl`, `git push` to an explicit URL) is charter guidance only; the harness does not block network access, which the model provider needs.
- The operator's notch panel kept the same process id through both runs, so the scratch sessions did not replace it. Logs and caches under the real agent directory are still shared; the scratch runtime does not get its own `PI_CODING_AGENT_DIR`, which would need copies of auth and settings.

### Results

- **Stale thread (criterion 5):** Orchard reported Sam's numbers as "overdue since Monday 12 October, four days ago" at intake, in the sweep, and after a restart.
- **Finished worker (decision "until the operator replies"):** after the worker's mailbox report, Orchard summarized it and "left the worker window open for your acknowledgment". The window stayed open through a full sweep. After "Seen the CONTRIBUTING summary, thanks." Orchard closed it and recorded the acknowledgment.
- **Restart:** `pi --session-id orchard` reopens the same session, so the conversation simply continues: Orchard neither re-read the skill nor noticed that its scheduled sweep was gone. The skill now says to keep one sweep scheduled at all times and to check with `task` before finishing each reply. After Orchard re-read the updated skill (as a package update would require), a second restart followed by "Anything new on Sam?" produced `task list`, then a new scheduled sweep.

Criteria 1 to 4 passed again in the same way as run 1.
