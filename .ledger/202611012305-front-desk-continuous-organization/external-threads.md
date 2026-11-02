# External threads (increment 7)

Owner: the implementation engineer hired for this lane. Integration lead: Tadhg Marinescu.

## Outcome

Events from GitHub (pull requests, their reviews, comments and CI check runs) and then Jira issues arrive in the organization as ordinary runtime threads. People who follow such a thread get every new event pushed to them as mail, exactly like a task thread. New activity nobody follows goes to the front desk (the on-call root coordinator), batched.

## Shape

- A new module `components/session-state/src/external-threads.ts` owns polling, event normalization, filtering and posting. Keep `runtime.ts` changes to a small hook (start/stop a poll timer, call into the module, dispatch the returned deliveries) and the new command kinds.
- Thread ids: `github:<owner>/<repo>#<number>` and `jira:<KEY-123>`. Kind `mail` (or a new `external` kind if that is clearly simpler for readers; decide and document). Subject: the PR or issue title. Posts are authored by `HARNESS` with a short, information-dense body: who did what, the first ~300 characters of text, and the URL.
- Tools for every person (add to `PERSON_TASK_TOOLS` in `work-tools.ts`, register in the session-state tools):
  - `follow_external({ url })`: create the thread if needed (backfill nothing older than now), make the caller a push participant. `url` is a GitHub PR/issue URL or a Jira issue URL/key.
  - `unfollow_external({ url })`.
  - `watch_repository({ repo, events? })` (managers/coordinator): new PRs and issues in that repo, and CI failures on its default branch, post to the desk channel described below, notifying the desk person.
- Polling: the runtime polls followed GitHub threads with the host `gh` CLI (`gh api`), with ETags or `since` cursors stored in a table, at a modest interval (one minute is fine; no premature optimization). A missing or unauthenticated `gh` records one clear event and skips GitHub; never crash the runtime. Jira uses the Atlassian credentials Agent World already stores (`apps/agent-world/src/backend/integrations/jira.ts` and the credentials file under the state directory); do Jira after GitHub works.
- Fast-path filters, as data in a small table or JSON file the operator can edit: ignore bot authors by default except CI results; CI: only completed check suites/runs with failure, or the first success after a failure; collapse bursts into one post per poll per thread.
- Outbound writes need no runtime work: people with shells already use `gh`. The operator decided agents may write to outside systems without per-write consent, except Slack messages on his behalf.

## Desk channel

Coordinate with Tadhg: he is adding the desk (a channel the root coordinator listens to) in the Workplace Chat increment. Until it exists, post unfollowed activity as mail to the on-call root coordinator (a root session whose role dispatches; `sessions.on_call = 1`).

## Done when

- Following a real PR in this repository delivers a new review comment and a failing check to the follower as mail, with the follower at home and on call being woken.
- Focused tests with a fake `gh` on PATH cover: first follow, new comment, CI failure and recovery filtering, bot filtering, missing `gh`, restart without duplicate posts.
- `docs/session-state.md` documents it; context files record non-obvious invariants.
- Commits are yours, staged by explicit path.

## Conventions

- Use the `edit`/`write` tools for file changes, not scripts. Read a file's `.context/` sidecar before editing it.
- Run only the test files relevant to your change, `--maxWorkers=1`; never the full suite.
- Others edit this checkout. Commit whole files you own; leave other changes alone. Tadhg is editing `runtime.ts`, `schema.ts`, `protocol.ts` and Workplace Chat at the same time: keep your `runtime.ts`/`schema.ts` changes small and append new migrations at the end; if a conflict appears, reread and reapply.
- The runtime daemon keeps running old code; restarting it is Tadhg's call. Test with isolated runtimes (`components/session-state/tests/helpers.ts`).
