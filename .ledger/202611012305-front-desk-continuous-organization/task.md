Status: in-progress
Created: 2026-11-01
Updated: 2026-11-01

# Build the front desk: the organization as one continuous agent

## Intent

Implement the whole approved proposal (`.ledger/history/202611012244-super-agent-extrapolation-the-org-as-one-continuous-agent-behind-slack-style-cha/proposal.md`, decisions in section 7): the operator talks to the organization, not to sessions. Workplace Chat is the only surface and may be redesigned freely toward a Slack-grade product.

Operator decisions: coordinator channel is the default composer; the coordinator assigns, hires and calls in without asking; agents write to outside systems without per-write consent except Slack messages on the operator's behalf; cost is irrelevant until outcomes are maximized; no benchmark phase, the operator validates through use.

## Increments

1. Dispatch posture: roles that cannot run commands or edit files; coordinator uses it.
2. On call: mail wakes an at-home person who is on call; the coordinator is on call.
3. Durable runtime schedules that send ordinary mail on time.
4. Desk: a coordinator-listened channel; the operator's default Chat composer posts there.
5. Chat Threads view (task threads) and Activity view (what needs the operator).
6. Watchdog role, driven by a schedule.
7. External threads: GitHub PRs and CI, then Jira; source policies; subscription by membership; autonomous outbound.
8. Channel charters for proactive and speculative work.
9. Inline & Spill delivery for pushed mail.
10. Chat polish throughout.

## Done when

Each increment is committed, activated (runtime restart, app relaunch) and usable from Workplace Chat; focused tests pass for each; the operator can run his day from the desk.

## Current State

- Done: 1 dispatch posture (5445637e), 2 on call (5445637e), 3 durable schedules (7a8e15f5), 4 desk + 5 Threads/Activity/side panel (196f64d5), 6 watchdog role (da8f6225), Command-K switcher (ed6344a7).
- Done: 7 external threads (Fiona Andreou, 75d1ac4e; fake-source proof; live real-PR check blocked: no open PR, gh account cannot push), 8 channel charters (0a72964c).
- Activated: runtime restarted on 0a72964c (schema 43), Agent World relaunched. Existing sessions pick up posture/on-call after a reload.
- Live external-threads check passed for comment/review/inline (PR #1 on z3z1ma/apple-pi, closed); it exposed an empty-prompt wake bug, fixed in 8a7a7e49. Review follow-ups fixed in 9042d287, f21fea0a, fff5eef2. CI live remains unproven (no workflows).
- Polish rounds after the operator's "every micrometer" request: Mail rebuilt (c980138d), groups and desk listener binding, Activity new-since badges, collapsible and custom sidebar sections (a9bf0c4e, f426207a), channel/group headers with charter, Threads with previews/unread/search (29209e98), Org/Issues/Code alignment and naming (ccecc462, 6056977a). Live read-only mirror for audits: live-mirror.ts in this bundle.
- Running on f426207a runtime (schema 44); Agent World on 6056977a.
- Delegated: session_search fixes (Kofi Bhattacharya, approved); transcript archive deferred by the operator.
- Dropped: 9 Inline & Spill. It saves tokens at the cost of extra reads; the operator ranked outcomes over cost, so full bodies stay.

## Outcome

Pending.
