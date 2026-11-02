# The organization as one continuous agent

A proposal from reading DeepSeek Harness's "Super-agent" article against what apple-pi actually is. It is deliberately bold. Each move says what exists (with the file that proves it) and what is missing.

## 1. The thesis in one paragraph

DeepSeek's central finding is that **the bottleneck has moved from model capability to human attention**: a person can follow 3 to 5 sessions. Their answer is a flat, two-level system — one Router that talks to humans and never executes, many isolated Workers, and an event stream (Triggers) that drives both. Their open problems are exactly where apple-pi is already ahead: how to scale the Router (8.1), how to work without sessions (8.2), and how agents with separate context boundaries collaborate (8.3). apple-pi's organization tree, threads and channels are a **recursive** version of their two levels: every manager is a router for its subtree, every subtree is a context boundary, and mail is agent-to-agent communication. What we lack is everything that makes the system *continuous, proactive and persistent* for the operator: the outside world does not enter as threads, the coordinator is not structurally a router, nothing durable wakes anyone, nothing watches progress, and Chat still asks the operator to manage sessions one DM at a time.

The bold extrapolation: **the operator talks to the organization, not to sessions.** Chat becomes Slack for a company whose employees are agents; sessions become an implementation detail behind threads; the coordinator is the always-on front desk; managers are routers all the way down.

## 2. Where we stand against their five modules

| DeepSeek module | apple-pi today | Gap |
| --- | --- | --- |
| Two-level Router/Worker (§2) | A tree of managers and reports; `coordinator` role is "chief of staff… you are not responsible for doing the engineering yourself" (`roles/coordinator.md`). Charter forbids managers acting as relays (`docs/organization.md`, Rules). | The coordinator is a *prompt*, not a posture. It has `writes: true`, and `writes: false` only removes `edit`/`write`, not `bash` (`components/organization/src/session-role.ts:88`). Their ablation (§7.1) shows prompts fail: with a neutral prompt the main session delegated in 0 of 5 runs. |
| Batching at the Router (§2.1) | The bridge drains every queued mail at one boundary into one request (`docs/session-state.md`, Mail and threads). | None. We already batch. |
| Triggers, filtering, subscription and pass-through (§3) | Internal threads only. Task threads push to assignees; channels pull with explicit `notify` (`docs/organization.md`, Threads). `monitor` turns stdout into steers for one session (`docs/tasks.md`). | External streams (GitHub PRs, CI, Jira, Slack, email) never become threads. No fast-path source policy, no subscription of a person to an outside thread, no routing of a new outside thread to the coordinator. Agent World already holds Atlassian and Slack sign-ins and uses `gh` (`docs/agent-world.md`), but only for operator-driven reads. |
| Inline & Spill, Chain of Recall (§3.3) | Stable IDs everywhere: `thread:seq` references, tasks, `link` graph, `search_messages`, `read_thread` pages, notebook receipts. | Pushed mail arrives whole. Nothing inlines next-hop IDs and summaries on push, so a router's context fills with bodies rather than references. |
| Speculative execution (§3.4) | None. | No "silently reproduce and fix" policy anywhere. |
| Full duplex (§4.1) | Background `bash`, `monitor`, `remind_me`; Chat offers Redirect now / Tell it after this / Stop (`docs/workplace.md`). | Already better than their default ("implemented but not enabled"). |
| Multi-channel norms (§4.2) | One norm: workers' tool chatter stays in their own transcripts; Chat hides tool calls by default. | No per-channel reply norms (their 100-word cap for IM). No outbound to external channels except operator-confirmed writes. |
| Compute/state/environment separation (§5) | One runtime daemon per Mac owns all state; sessions are local processes (`docs/session-state.md`). | Everything stops when the Mac sleeps. No second machine. |
| Watchdog (§6) | Structural coordination notices for wait cycles and fan-in (`docs/organization.md`, Proactive coordination notices); a stream watchdog for stalled Anthropic responses (`docs/anthropic-watchdog.md`); liveness checks mark lost processes. | Nothing judges *progress or drift*. Nothing revives a lost person. Reminders are session-scoped and die with the session (`docs/tasks.md`), so there is no durable clock to drive a watchdog. |

## 3. Where we should not copy them

- **Two levels is a special case.** Their 8.1 asks when to shard the Router and admits the trade-off "will remain until the global memory problem is solved". Our answer already exists: shard by organization. A team head routes for its team; the root coordinator routes across heads. Context boundaries are subtrees; channels are the shared context of a boundary; mail crosses boundaries. Do not flatten our tree into Router + Workers.
- **Cloud first is not our constraint.** Their §5 is driven by a hosted product. Our operator's environment is his Mac with uncommitted changes and credentials — exactly the "BYOM" case they find hardest. Persistence for us means *the Mac's runtime stays the brain* and other machines are hands, not moving the brain to the cloud.
- **"Sessions are an implementation detail" goes too far for us.** Our people have selves, records and colleagues' views of them; the organization's distinctiveness comes from persistent people. Keep people visible (Slack keeps DMs). Hide *sessions-as-work-units*, not people.

## 4. Drastic moves, ranked by leverage

### Move 1 — Talk to the organization, not to sessions (Chat as Slack for an agent company)

The operator's default act becomes posting in a channel or a thread, not instructing a DM.

- **#operator (or the workspace's general channel) has a standing listener: the root coordinator.** The operator writes there without addressing anyone. The coordinator acknowledges in under 100 words, creates or finds the task, assigns it, and replies *in thread*.
- **Every task thread is a Slack thread.** Today task threads exist (`docs/organization.md`, Tasks and assignments) but Chat shows DMs and channels. Add Slack's **Threads** view: every task the operator started or follows, newest activity first, with assignee avatars and presence. Replying in a task thread pushes to its assignees — this *is* DeepSeek's pass-through, with the operator as a subscriber.
- **An Activity view becomes the attention queue**: questions waiting for him, escalations, decisions, sign-offs (review sign-off, Jira write consent), finished results unseen. Ordered by what blocks the most work, not by time. The runtime already records `needs_you_since`, escalations and pending decisions (`docs/session-state.md`, Attention; `/org` overview).
- **DMs remain for drill-down**, like opening a colleague's screen. The presence dots we just shipped become the at-a-glance health of the whole company.

### Move 2 — Make the router structural, not a prompt

- Add a **dispatch posture** for roles: no `bash`, `edit`, `write`, or `pi_exec` composition of tools — only communication, task, link, introspection and manager tools. DeepSeek's Router "can run without a Bash tool at all"; their ablation is direct evidence that prompt-only delegation fails.
- Make `coordinator` dispatch-only.
- **Recursive**: any manager with reports can be hired dispatch-only. Managers already must not be relays; the posture makes "route, don't do" enforceable rather than hoped for.
- **Always present**: the root coordinator has a fixed session id and is woken by the runtime when mail arrives (today, at-home mail waits and does not launch: `docs/session-state.md`). Introduce one per-person flag, **on call**, which the operator sets on the coordinator and team heads.

### Move 3 — Bring the outside world in as threads

One runtime concept, **external threads**: a GitHub PR, a CI run, a Jira issue, a Slack thread, an email chain each becomes a runtime thread with stable identity whose new events append as messages.

- **Fast path in code**: per-source policy — `ignore`, `candidate`, `explicit request only` — exactly DeepSeek's §3.1 programmatic stage, as data the operator edits.
- **Slow path**: unsubscribed candidate events go to the coordinator (or the owning team head) as one batched mail.
- **Subscription = existing thread membership.** A person assigned to a PR task joins its external thread; later events push straight to them. No new delivery mechanism: task threads already push to members.
- **Outbound is autonomous** (operator decision): agents reply to outside systems directly, recorded in the existing outside-write log (`~/.pi/agent/state/agent-world-outside-writes.jsonl`). The one exception is Slack messages on the operator's behalf, which stay confirmed.
- **Start with GitHub**: `gh` is already used, PR review comments and CI results are the highest-value, lowest-injection-risk stream, and our captured review queue can post to the same PR thread.

### Move 4 — A durable clock and a watchdog person

- Add **runtime-owned schedules** (durable, survive restarts, send ordinary mail on time). Today `remind_me` dies with its session, and `pi-send.mjs` needs launchd. This is small and unlocks everything periodic.
- Hire a standing **watchdog** (a new role, or the existing `principal-site-reliability-engineer` with a specialization) driven by a schedule. Each tick it reads `progress`, `bottlenecks`, liveness and recent transcripts, and judges *substantive progress vs. drift* per assignment — the part our structural notices deliberately do not do. It revives lost people (`call_in`), nudges stalled ones, and escalates only what needs the operator.
- Because it is a person with full tools, the operator can ask it in Chat "why did X stall?" — DeepSeek's §6 point that a watchdog should be conversable.

### Move 5 — Standing policies for proactive, speculative work

- Give channels a **charter**: a short prompt-policy carried by the channel ("in #bugs, when someone reports a failure, reproduce silently in a worktree; post only a confirmed reproduction with a fix PR"). This is DeepSeek's semantic policy layer and speculative execution in one primitive, stored on the existing channel purpose.
- The listener that applies a charter is whoever the team head assigns; results return in the originating thread.
- Speculative results that turn out unused are discarded.

### Move 6 — Inline & Spill for every push

- Pushed mail and Trigger batches arrive as **references with summaries** (thread id, seq, author, first ~200 characters, related task and link ids), with the body spilled behind `read_thread`. Routers stay light; workers that need the body read it.
- This reuses our existing IDs and readers; it is a delivery-format change in the bridge, not a new store. Caution: our request context is append-only for prompt caching (`AGENTS.md`), so this must be the format of *new* messages, never a rewrite of old ones.

### Move 7 (horizon) — Many machines, one organization

- The Mac runtime stays the brain and the only state writer. Other machines run a thin endpoint (sessions launched there report through a forwarded socket). People gain a `host`. This is BYOM in reverse: the brain is personal, the hands can be anywhere.
- Only worth doing once Moves 1–4 make the organization continuously valuable; until then the Mac sleeping is not the binding constraint.

## 5. Why this compounds

Each move feeds the next. External threads (3) give the coordinator (2) something to route and the watchdog (4) something to measure; channel charters (5) turn recurring routing into policy; the Activity view (1) shows the operator only what needs him. As agents communicate more through threads, Chat shows more of the company's real state without the operator asking. The org tree is what makes this scale where DeepSeek's single Router does not: a busy team head absorbs its team's traffic, and the root only sees cross-team events. **Attention cost grows with the number of decisions, not the number of agents.**

## 6. Build order

No benchmark phase: the operator uses apple-pi daily, including to build apple-pi, and is the arbiter of whether it works. Build, ship, and let use judge.

1. **Front desk.** Dispatch posture for roles; a dispatch-only, on-call root coordinator woken by mail; the operator's default composer posts to the coordinator's channel; Chat **Threads** view over task threads and an **Activity** attention view.
2. **Durable runtime schedules** sending ordinary mail, and a standing **watchdog** person driven by them.
3. **External threads**, starting with GitHub PRs and CI, then Jira; fast-path source policies; subscription via thread membership; outbound writes without per-write consent.
4. **Channel charters** for proactive and speculative work.
5. **Inline & Spill** delivery for pushed mail and Trigger batches.
6. Many machines, one organization (horizon).

## 7. Operator decisions (sign-off, 2026-11-02)

1. **Default surface:** the default composer posts to the coordinator's channel; DMs are drill-down.
2. **Front-desk authority:** yes. The coordinator assigns, hires and calls in without asking.
3. **Outbound autonomy:** agents may make every outside write without per-write consent, except sending Slack messages on the operator's behalf.
4. **Cost:** irrelevant for now. Maximize outcomes first; balance economics only once outcomes are maximized. Choose the strongest models where they help.
5. **Slack itself:** no bridge. Workplace Chat is the only surface. We borrow from best-in-breed services, but it is a unique product for the operator.
6. **Evidence:** no verification theatre. The operator is the validator through use. The recursive-router structure has already proven itself in daily use.
