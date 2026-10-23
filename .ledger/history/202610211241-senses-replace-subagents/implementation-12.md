# Ticket 12 implementation notes

Scope: [workplace extras](tickets/12-workplace-extras.md), under the approved [specification](spec.md).

## Approach

- Queue a new hire's team-channel history inside the same transaction that creates its person and assignment. Use the existing channel reader, without inventing a message-count cap. Deliver startup context before triggering the first turn; both tmux and headless launches should begin through the bridge after hello, rather than racing a CLI positional prompt against mail replay.
- Keep retirement at the runtime's shared command boundary, so the model tool and Agent World behave alike. Ask the person for one handover through the existing correlated-turn mechanism, waiting for it to be idle and waking it if asleep. Tell it that its final prose will be posted verbatim to the team channel. Commit that authored post and retirement together, then close the person. This needs neither another runner nor a handover schema.
- Failure or cancellation leaves the person unretired. Runtime recovery must recognize an already committed handover rather than publish it twice. A caller disconnect cancels its owned handover turn, not unrelated work. An asleep person woken for a failed handover stays available for its manager to inspect or send home.
- The manager charter offers a short standup using the existing reminder and meeting tools, at the manager's judgment. The directory's finished-assignment record already exists from ticket 06; verify it through the public tool rather than add a second record.

## Verification

- Native faux Pi sessions prove that the first model request includes the channel history and assigned goal; handover is authored by the person; busy work finishes first; empty output fails visibly; and cancelling the caller stops only its handover and leaves the person in the team. The initial onboarding and handover tests failed on the old behavior.
- A scratch CLI process proves that an asleep person wakes with its existing id, name, manager, and role, receives only the correlated handover, and closes afterward. Persisted recovery fixtures prove no duplicate post or automatic model rerun, incarnation-bound close replay, and rollback of the handover, retirement, and membership when the close outbox fails. The reconnect test caught old mail replaying before a committed close; close now takes precedence.
- `/tmp/apc12-lifecycle-green.log`: 24 tests passed across workplace and coordinator suites. `/tmp/apc12-focused-final.log`: 193 passed with two obsolete CLI-prompt assertions, both updated for bridge startup and passed in the World rerun. The public `work.test.ts` directory test checks finished assignments and outcomes.
- `/tmp/apc12-world-final.log`: backend, hire, wake, rename, and build suites passed. The browser's retirement and rename checks passed; nine recruit-layout checks still expected the pre-ticket-07 label `Brief`. Corrected to `Goal`; all nine passed in `/tmp/apc12-form-green.log`. The lifecycle API test advances past the old ten-second close wait and proves retirement remains pending until its handover completes.
- `npm run build:world`, typecheck, loader, formatting, and lint passed. Lint retains the existing notch-test template-string warning. `context_lint` passed (131 files); `git diff --check` passed. No full suite yet; that remains the end-of-task check.
- No live operator runtime or sessions were restarted.

## Lessons

A faux-session reply queue holds messages, not callbacks. A held or multi-turn request uses the callback form returning a promise. Vitest transpiles an invalid typed fixture, so a callback mistakenly placed in the queue produced a malformed message and settled the supposedly busy turn; typecheck is part of the proof, not a substitute for the behavioral tests.
