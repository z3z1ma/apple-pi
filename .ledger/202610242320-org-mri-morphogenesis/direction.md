# Direction: organizational observability first (2026-10-26), verbatim

The operator's direction adjustment, given after tickets 01 to 06 were built. It wins over [spec.md](spec.md), [thesis.md](thesis.md), and [source.md](source.md) where they differ. Completed work stays.

---

## Direction adjustment: organizational observability as the primary capability

We're partway through implementing the approved fitness-driven self-organization specification. I want to refine where this work ultimately lands without discarding the valuable substrate we've already built.

The goal is **not to replace the specification or undo completed work**. The links, task lifecycle facts, waiting relationships, economic events, fitness evaluator, and prediction machinery are useful capabilities.

But I want to change our emphasis.

**The harness should provide the organization with excellent instruments for understanding itself. The agents should decide how to use those instruments to organize themselves.**

A sufficiently capable manager already has the intelligence and tools to restructure its organization. It can hire, move, assign, wake, retire, communicate, delegate, and ask subordinate managers to reorganize their own teams.

What it lacks is cheap, reliable access to the organizational signals that make those decisions well-informed.

### 1. The philosophical boundary

I don't want to build a specialized organizational optimizer into the harness.

I want to give an intelligent manager everything it needs to perform organizational optimization itself.

Fitness remains a useful analytical instrument. It is not the mandatory objective for every management decision, and constructing scenarios should not become a required ritual before hiring, reassigning, or reorganizing.

The manager can consult fitness when an economic comparison is meaningful. It can also use direct evidence, uncertainty, organizational context, and judgment.

As models improve, this should become more powerful without us rewriting organizational decision algorithms.

Our guiding principle is:

**Mechanize observation and state transitions. Leave interpretation, strategy, and organizational judgment to the agents.**

### 2. Make the organization deeply introspectable

I want a manager to be able to inspect the operational reality of its organization without manually reconstructing it from database queries, transcripts, and scattered files every time.

We already have an excellent foundation:

- Persistent people with identities, roles, managers, assignments, and histories.
- Explicit work, task lifecycle events, and focused assignments.
- Threads, mail, meetings, and escalation.
- Generic links between entities, including `blocks` and `requires_decision`.
- Runtime events, tool activity, compute expenditure, and historical state.
- Organizational actions that can reshape the hierarchy.

We need to expose the useful signals derived from these facts.

Prioritize questions like:

**Waiting and blockers**
- How many tasks are currently blocked?
- What specifically is each task waiting on?
- How long has each wait been open?
- Which decisions or dependencies block several tasks?
- Which people or teams are waiting on other teams?
- Which waits have accumulated the most elapsed time?
- What became unblocked recently?

**Work and capacity**
- What work is assigned, unassigned, in progress, waiting, or completed?
- Where is ready work accumulating without an owner?
- Which agents have multiple outstanding assignments?
- Which agents are active, idle, or dormant?
- Where are work arrivals exceeding completions?
- Which tasks are aging without observed progress?

**Organizational coordination**
- Which managers have the most outstanding escalations or decisions?
- Where is decision fan-in concentrated?
- Where are cross-team dependencies concentrated?
- Which work repeatedly moves between people or teams?
- Where is coordination activity substantial relative to observable progress?
- Which subtrees appear to be constrained by a shared dependency?

**Execution and economics**
- Where is inference expenditure accumulating?
- Which tasks or workstreams are consuming resources without producing completed outcomes?
- What does the existing fitness breakdown reveal?
- What changed in activity, throughput, waiting, or cost over a selected period?

These are examples of useful observations, not a mandate to implement every metric immediately.

### 3. Provide a small, expressive read-only tool surface

I'd strongly prefer **one composable organizational inspection tool**, perhaps `org_inspect`, over a proliferation of specialized diagnostic tools.

The exact API is yours to derive from the existing conventions.

It should support some combination of:

- Scope: organization, manager subtree, person, or task.
- Focus: overview, blockers, work flow, coordination, load, activity, or economic contributions.
- Time window where applicable.
- Compact summaries with the ability to drill into underlying evidence.

Default calls should be concise and cheap.

For example, a manager should be able to discover that four tasks are blocked, three are waiting on one architectural decision, two are ready but unassigned, and one manager has several outstanding escalations.

Then it should be able to inspect the relevant tasks, people, links, and threads without reconstructing everything manually.

Every important result should carry references to the underlying facts so an agent can investigate further.

Use structured, programmatically consumable results where useful, but do not flood the caller's context with raw transcripts.

**The instrument should reduce the cost of observation, not introduce another expensive reasoning process.**

### 4. Do not confuse signals with diagnoses

I want to be particularly careful about this.

A high message count doesn't prove inefficient communication.

Many direct reports don't automatically mean a manager is overloaded.

An old assignment doesn't prove an agent is stuck.

Several agents working on one area doesn't necessarily mean duplicated effort.

An open `blocks` link is evidence of an explicitly recorded wait. Its age is measurable. Whether it represents an organizational problem is a judgment.

So the harness should report the underlying facts, including relevant aggregations and relationships, without pretending to know more than it does.

It's fine to surface patterns such as concentrated fan-in, aging work, or shared blockers. But don't convert them into an invented universal "organizational tension score."

The **manager interprets the signals**.

Don't create a new ontology of organizational pathologies, a diagnostic model, or a rule engine for deciding which intervention is appropriate.

### 5. Preserve links as a foundational primitive

I consider the generic link system one of the most important things we're building.

It's valuable independently of fitness.

Links let agents express durable relationships between work, people, decisions, conversations, artifacts, evidence, and external systems.

Waiting relationships are particularly valuable because they make previously invisible coordination state explicit and queryable.

Build on the existing link system. Do not replace it with specialized blocker tables, dependency objects, or new workflow records.

Where signals can be derived from links and existing runtime history, derive them.

Introduce additional persisted facts only when essential information would otherwise be unavailable or irrecoverable.

### 6. Let organizational behavior emerge from the existing management system

Managers should be able to use these signals however they judge appropriate.

A root coordinator may notice a concentration of blocking decisions and resolve the decisions itself.

It may delegate investigation to an existing specialist.

It may ask a subordinate manager to inspect and reorganize that manager's subtree.

It may move people between managers, assign idle capacity to ready work, wake an experienced colleague, hire a missing perspective, or do nothing.

The organization already has the necessary mutation capabilities.

**Don't add a second organizational command interface or an automatic restructuring controller.**

The signal tools should be read-only. Actual changes continue through the existing manager tools and authority boundaries.

Subordinate managers should have the same introspective capabilities within their relevant organizational context, so restructuring can be decentralized naturally.

### 7. Reposition fitness as an optional, powerful instrument

Keep the fitness evaluator and the scenario machinery we've implemented. Don't throw away useful work.

But I no longer want the manager charter to imply that every organizational action must be justified by a numerical forecast or that the organization must always hill-climb a computed scalar.

Instead, teach managers to:

- Inspect organizational signals during their existing sweeps and when work appears constrained.
- Investigate causes using tasks, links, history, and direct communication.
- Consider organizational changes based on observed conditions and expected consequences.
- Use fitness or scenarios when quantitative comparison would genuinely help.
- Record important reasoning and revisit consequential decisions.
- Preserve stability when restructuring would create more disruption than value.

The important behavior is **evidence-informed adaptation**, not compulsory optimization bookkeeping.

We should preserve the option to develop more sophisticated fitness-driven strategies later, using the same underlying primitives.

### 8. Keep the implementation aggressively simple

Before adding code, inspect what's already available through the runtime, directory, links, existing evaluator, and manager tools.

Identify which questions can already be answered cheaply, which only need a read-only projection or query, and which genuinely require new observations.

Prefer straightforward derived views over new persisted state.

Prefer one expressive tool over many narrow tools, provided it remains understandable.

Avoid new background agents, controllers, scheduling systems, orchestration frameworks, approval mechanisms, and duplicated organizational state.

Tests should establish that returned signals are correct, appropriately scoped, consistent with underlying history, and backed by inspectable facts. Do not test arbitrary managerial heuristics.

### 9. Define success by the manager's experience

The concrete acceptance demonstration I'd like is this:

Give a manager an organization containing several active tasks, overlapping dependencies, dormant specialists, unanswered decisions, and unevenly distributed work.

It should be able to inspect the organization in one or two calls and understand:

- What work is blocked and why.
- Where ready work is waiting for capacity.
- Where decisions and requests are accumulating.
- Which agents or managers are involved.
- What evidence it should inspect next.

It should then be able to choose a reasonable intervention using existing organizational tools, potentially delegating the response to a subordinate manager.

After acting, it should be able to inspect the organization again and observe the corresponding changes in the underlying signals.

The harness does not need to judge whether its management decision was optimal.

It needs to make the situation legible and subsequent changes observable.

### 10. How to proceed from the current implementation

We're already around ticket 5 of the approved implementation. Do not reset the project or rewrite completed work merely because of this direction adjustment.

First, inspect the current implementation and remaining tickets.

Identify the smallest change to the remaining scope that makes organizational introspection a first-class capability.

Preserve completed, coherent features. Reuse the existing runtime and link abstractions. Avoid making optional fitness or prediction workflows mandatory in the manager charter.

Update the remaining plan as narrowly as possible, then implement the smallest end-to-end organizational inspection surface using the existing project conventions.

**The desired landing zone is a substrate that makes the organization observable to itself, and a set of capable, persistent managers that can use those observations to adapt their own structure.**

That's the enduring abstraction.

The harness provides the instruments. The organization supplies the intelligence.
