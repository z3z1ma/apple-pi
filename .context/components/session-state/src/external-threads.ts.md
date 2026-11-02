## file

External threads deliberately use ordinary `mail` kind and pushed participant rows. Their source id is global per GitHub item or Jira key; the source table owns polling/cursors, not a second subscription list. A first follow, and re-follow after all followers left, starts at the command's accepted time. Existing followers keep their cursor when another person joins. Repository watches discover candidates; they do not subscribe the desk person to each outside item.
Why: thread membership is the existing authority for delivery, inbox and on-call waking. Backfilling old outside discussion on subscription would wake people for unrelated history.

`ExternalCommit` is supplied by the runtime and commits cursor advancement, consumed identities, normalized messages and ordinary mail outbox rows in one transaction before dispatch. Network requests finish before entering it. A poll compares its captured state with the current row before committing so a simultaneous re-follow cannot restore a stale cursor. Bot-filtered events and quiet CI successes are consumed too; replaying an old success would otherwise erase a newer failure and lose the recovery transition. Check-run failure state is retained across head commits by check name.
Why: deduplication by timestamp alone loses overlapping polls, retries and restarts; advancing a cursor before publication can permanently lose mail. Source APIs expose second-resolution timestamps, so comment queries overlap the previous cursor by a second and identity deduplication removes repeats.

The daemon imports this module directly under Node type stripping; its class fields use erasable TypeScript rather than constructor parameter properties. The focused suite checks native daemon import as well as the Vitest-transformed implementation.
Why: an initial constructor passed TypeScript and in-process tests but blocked every real daemon start with ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX.

Shutdown aborts requests and each awaited continuation checks the abort signal before touching the database. Error events contain fixed operational messages or endpoint paths, not raw authenticated HTTP output or credentials. Jira checks the stored source origin against the current signed-in site before every poll.
Why: the runtime closes its only writer connection synchronously on stop, and changing the operator's Atlassian account must not silently turn an old issue subscription into another site's issue.

Coupled: components/session-state/src/runtime.ts, components/session-state/src/schema.ts, components/session-state/src/threads.ts, components/session-state/src/external-tools.ts, apps/agent-world/src/backend/integrations/credentials.ts
Verify: components/session-state/tests/external-threads.test.ts
