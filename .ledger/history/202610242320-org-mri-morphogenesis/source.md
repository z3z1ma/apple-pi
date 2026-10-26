# Source: the operator's design brief (2026-10-24), verbatim

This brief is the authority for this map. The operator, 2026-10-24: "we are going to follow our own literature verbatim. We are taking a bet. And will let the data speak for itself over the next few months." Where it conflicts with an earlier finding or a repository boundary, the brief wins and the boundary is updated. It was given in Pi session `01a171af-7866-776f-a1fc-d41b7c525b38` (Agnieszka Qureshi).

---

# Organizational Morphogenesis & MRI: Building a Self-Optimizing Agent Organization

I think these two ideas, developed together, could become the most consequential part of `apple-pi`.

And I agree with your distinction: this is fundamentally a runtime and organizational-substrate problem. Agent World should be one exceptionally expressive interface onto the system, not the place where organizational intelligence lives.

After looking more closely at your existing session-state runtime, organization implementation, and manager charters, I would frame the opportunity this way:

> Build an organization that can observe the costs of its own cognition and coordination, diagnose structural inefficiencies, and adapt its topology to the work it is doing—without sacrificing accumulated knowledge or introducing gratuitous coordination.

That combines two feedback loops:

- Organizational MRI: What is happening, where is time and intelligence being wasted, and what evidence explains it?
- Organizational Morphogenesis: Given that evidence, should we change the allocation of work, the composition of the workforce, or the organization itself?

The deeper ambition is not an AI manager that occasionally hires more agents. It is an adaptive computational system whose organization is itself part of the optimization space.

## 1. A different way to think about the organization

Your existing system treats persistent Pi sessions as people, with immutable roles, individual contexts, memories, assignments, reporting relationships, and communication channels.

This creates a property that most orchestration systems lack:

Agents aren't interchangeable workers. They're stateful stores of specialized, accumulated context.

That changes the economics of organizational design.

Hiring a new agent incurs context-acquisition costs. Moving someone to a different manager changes reporting and coordination patterns, potentially without losing their accumulated knowledge. Reusing an experienced but dormant agent can be cheaper than creating another one.

And hiring a manager introduces a new computational node whose value must exceed its own coordination overhead.

### Four graphs, not one hierarchy

I'd model the organization as four overlapping graphs.

Authority graph

Who assigns work, makes decisions, manages resources, and receives escalations.

Dependency graph

Which tasks, decisions, artifacts, and verification gates constrain others.

Communication graph

Who actually exchanges information with whom, how often, and for what reason.

Knowledge graph

Where relevant experience, decisions, expertise, and reusable procedures are located.

Your reporting tree should remain a tree. Your communication network absolutely should not.

And your dependency and knowledge graphs should evolve independently of both.

This is a critical separation. You don't want the optimizer to confuse organizational proximity with access to information. An implementation engineer should be able to consult a database specialist in another team without asking three managers to forward messages.

Your existing design already supports this: managers govern work and escalation, while people can communicate directly across the organization. I would preserve that as a foundational invariant. See [organization.md](https://github.com/z3z1ma/apple-pi/blob/main/docs/organization.md).

### The organization is really a context-placement system

This is the first idea I'd push beyond the human-company metaphor.

In a software organization, much of the cost of work comes from reconstructing context: understanding the codebase, discovering prior decisions, locating relevant knowledge, interpreting requirements, and understanding why previous attempts failed.

Persistent agent sessions retain some of that information. Project files and the wiki retain other parts. Threads provide shared history.

Therefore, organizational design can be understood partly as a data-locality problem.

You want the right context near the computations that need it.

That suggests an analogy to scheduling distributed workloads:

| Distributed systems concept | Agent organization equivalent                     |
| --------------------------- | ------------------------------------------------- |
| Warm cache                  | Agent with relevant accumulated context           |
| Cold start                  | New agent acquiring project context               |
| Cache miss                  | Repeated investigation or rediscovery             |
| Data locality               | Assigning work to the person who knows the area   |
| Network overhead            | Cross-agent communication and handoffs            |
| Load balancing              | Assignment, delegation, and staffing              |
| Cache invalidation          | Context made stale by code or decision changes    |
| Autoscaling                 | Hiring, waking, and sending agents home           |
| Partitioning                | Separating work into relatively independent teams |

This analogy isn't exact—human-like judgment, diversity of perspectives, and quality assurance cannot be reduced to cache hits—but it is a powerful starting point.

A newly hired expert model may have greater raw capability than an existing cheaper model, yet still be less effective on a task because it lacks 30 hours of accumulated project context.

Similarly, moving an experienced specialist between teams might be a better optimization than hiring someone.

Morphogenesis should optimize the placement and use of organizational knowledge, not merely the number of agents.

## 2. The actual optimization problem

I would avoid collapsing everything into one arbitrary organizational fitness score.

Quality, latency, cost, and risk do not have interchangeable units, and some risks should be hard constraints rather than things the system can trade for cheaper tokens.

A more useful formulation is:

$$
\begin{aligned}
\min_{\pi}\quad \mathbb{E}\big[ & C_{\text{compute}} + \lambda_t T_{\text{delivery}} + \lambda_h C_{\text{human-attention}} \\
&+ \lambda_c C_{\text{coordination}} + \lambda_x C_{\text{context-reconstruction}} \\
&+ \lambda_r C_{\text{reorganization}} \big]
\end{aligned}
$$

Subject to constraints on correctness, verification, budget, permissions, and acceptable operational risk.

Here, $\pi$ is an organizational policy: a strategy that determines which workers to use, how to structure their responsibilities, when to escalate, and when to reconfigure the organization.

The terms have useful distinctions.

Compute cost is inference and tool execution, including repeated unsuccessful attempts. Delivery time should emphasize the critical path, not elapsed time spent on unrelated parallel work. Human-attention cost counts consequential interruptions and review burden, not merely messages. Coordination cost includes meetings, routing, handoffs, integration, and time waiting for decisions. Context-reconstruction cost measures the work required to regain information that once existed somewhere in the organization. Reorganization cost captures the disruption and new context acquisition caused by changing the topology.

The last two are particularly easy to overlook.

An aggressive optimizer that reorganizes every time a queue length changes will spend its life rearranging agents.

An optimizer that perpetually hires new specialists may appear fast while repeatedly paying for context acquisition, duplicating investigations, and increasing integration risk.

The goal should instead be:

Find the smallest, most context-efficient organization that reliably produces the required outcome within the constraints.

Sometimes that is one agent. Sometimes a small group of independent reviewers. Sometimes a temporary hierarchy of 20 people.

The correct topology is conditional on the task, the existing workforce, the available knowledge, and the consequences of being wrong.

## 3. Organizational MRI: measuring the invisible costs

The MRI should be much more than a dashboard showing busy agents, idle agents, token counts, and message traffic.

I would design it as a diagnostic engine that produces evidence-backed explanations of inefficiency.

The key question is not, "How much activity is happening?"

It's:

> "What specific constraint is preventing this organization from converting its available intelligence into verified progress?"

That means distinguishing symptoms from causes.

An agent waiting 20 minutes is not necessarily a problem. It might be waiting for a valid dependency, awaiting a test, or simply finished with its work.

Ten messages between two specialists might be wasteful coordination. Or they might have prevented a catastrophic architectural mistake.

We need to make the underlying causal relationships legible.

### The first seven signals I would instrument

| Signal                     | What it reveals                                                            | Potential organizational response                       |
| -------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------- |
| Critical-path waiting      | Work that could progress except for an unresolved dependency or decision   | Unblock, reassign, or parallelize                       |
| Decision fan-in            | A manager or specialist becoming a serial decision bottleneck              | Delegate authority or restructure                       |
| Context rehydration        | Compute spent reconstructing information that should already be available  | Reuse a knowledgeable agent or improve shared knowledge |
| Coordination amplification | Increasing communication or integration cost without commensurate progress | Change task boundaries or team structure                |
| Duplicated investigation   | Multiple agents independently rediscovering the same information           | Share evidence or clarify ownership                     |
| Expertise locality         | Important work repeatedly routed away from people with relevant experience | Reallocate work or create a domain team                 |
| Verification debt          | Implementation progressing faster than independent evidence of correctness | Allocate verification capacity                          |

I would not initially put all these into one "efficiency" number. Each signal describes a different failure mode and implies different interventions.

### Critical-path waiting is more meaningful than utilization

Traditional dashboards emphasize utilization. For agent organizations, that's often the wrong metric.

Suppose five agents are working continuously but all depend on an architectural decision held by one sixth agent.

The organization looks healthy: five agents active, ample tool execution, plenty of output.

But most of its work may be speculative or destined for rework.

Now consider an organization where three agents are asleep and one agent completes the whole critical path.

That can be dramatically more efficient.

The MRI should reconstruct a task dependency graph and estimate the remaining critical path:

$$
T_{\text{remaining}} \approx \max_{p\in\mathcal{P}} \sum_{i\in p}\widehat{d_i}
$$

Here, $\mathcal{P}$ is the set of remaining dependency paths, and $\widehat{d_i}$ is an estimate of each task's remaining duration.

This is only a useful approximation when dependencies and duration estimates are credible. Early versions should emphasize observed blockers rather than pretend to know exact completion times.

The important measurement is how much a particular blocker delays the expected completion of the outcome.

A two-hour wait on a noncritical documentation task may matter less than a ten-minute wait on a decision preventing four other tasks from proceeding.

That difference can drive organizational restructuring.

### Decision fan-in: the real reason to hire a manager

Your charter currently tells managers to add another manager when the fan-in of reports, questions, and escalations would make them the bottleneck.

I think this could become a genuinely measurable policy.

In queueing theory, a simple approximation of a decision processor's utilization is:

$$
\rho=\lambda\mathbb{E}[S]
$$

Where $\lambda$ is the arrival rate of decisions requiring that processor and $S$ is the service time per decision.

As utilization approaches capacity, waiting time can grow sharply. Real agent decision workloads are bursty and don't necessarily satisfy simple queueing assumptions, but the principle is valuable.

The MRI should distinguish people reporting to a manager from decisions that actually require that manager.

A director with 15 independent engineers may be fine. Another director with three people might be overwhelmed because every task requires a tightly coupled architectural judgment.

So I would define managerial pressure using three things: unresolved decisions, the critical-path impact of those decisions, and the manager's capacity to resolve them.

This leads to a much better restructuring rule:

Don't hire a new manager because the team got large. Hire one when a meaningful, separable decision domain is repeatedly bottlenecked on centralized authority.

Often, even then, the better intervention is simply to delegate that decision domain to an existing expert rather than introduce another hierarchy level.

### Context fragmentation: I think this is a major research opportunity

There are at least three distinct varieties.

Temporal fragmentation happens when an agent loses or reconstructs useful context across compactions, restarts, or long gaps between related tasks.

Social fragmentation happens when relevant knowledge exists in another agent, but locating and transferring that knowledge costs substantial effort.

Artifact fragmentation happens when decisions and evidence are scattered across transcripts, task files, the wiki, PRs, and external systems without useful connections.

These have different remedies.

Temporal fragmentation might call for better checkpointing or returning work to a previously warm session. Social fragmentation might call for different staffing or shared context. Artifact fragmentation might call for a persistent decision record or reusable program.

One particularly useful metric would be:

$$
C_{\text{rehydration}} = \text{cost between reactivation and first verified advance}
$$

This is a proxy, not a pure measure of context recovery. That interval may also include novel problem-solving. You would need to compare similar task classes and identify repeated reads or rediscovery to make it meaningful.

But it could reveal something quite important about your own architecture:

How much organizational knowledge survives as reusable capability, versus how much is repeatedly reconstructed through model inference?

That is a much more interesting question than simply tracking context-window utilization.

## 4. What your current substrate already measures

You're closer to an initial MRI than it might appear.

Your [session-state schema](https://github.com/z3z1ma/apple-pi/blob/main/components/session-state/src/schema.ts) already records sessions, incarnations, manager changes, tasks, assignments, focus, threads, commands, and append-only runtime events.

The [bridge](https://github.com/z3z1ma/apple-pi/blob/main/components/session-state/src/bridge.ts) observes top-level tool execution, durations, errors, run state, model cost, and context usage. Your [runtime](https://github.com/z3z1ma/apple-pi/blob/main/components/session-state/src/runtime.ts) also records command receipts and state transitions.

This is a strong factual substrate.

I see the gap less as missing telemetry and more as missing causality and attribution.

| Already represented                   | Still needed for trustworthy diagnosis                                      |
| ------------------------------------- | --------------------------------------------------------------------------- |
| Agent session and focused task        | Reliable attribution of work intervals and cost to outcomes                 |
| Assignment and completion             | Explicit blocking relationships and delivery evidence                       |
| Threads and messages                  | Distinction between coordination, decisions, and merely informative traffic |
| Tool calls and durations              | Connection between tool activity and verified progress                      |
| Manager changes                       | Organizational interventions and their measured consequences                |
| Model cost and context size           | Context recovery and organizational knowledge-reuse estimates               |
| PRs and external state in Agent World | Durable cross-references from external artifacts to tasks and sessions      |

I would be very conservative about what new data becomes first-class runtime state.

Your existing principle—agents report observed facts and the runtime remains authoritative—is valuable. Don't replace it with a second elaborate project-management database.

### Add causal links, not another task system

I'd introduce a compact set of durable relationships between existing entities.

Conceptually:

```ts
type WorkRelation =
  | "blocks"
  | "produced"
  | "verifies"
  | "requires_decision"
  | "supersedes";

interface WorkLink {
  from: EntityRef;
  to: EntityRef;
  relation: WorkRelation;
  evidence: EvidenceRef;
  createdAt: number;
  resolvedAt?: number;
}
```

The entities could be task IDs, session IDs, thread IDs, commits, PRs, or verification runs.

I wouldn't require every agent message to become structured data. Conversations should stay conversational.

Instead, when a consequential relationship exists, give it a durable reference.

For example, an engineer can naturally say, "I can't finalize this until the migration contract is decided," and record one `requires_decision` edge pointing at the relevant task or discussion.

That edge becomes useful to every agent and every interface. It can be cleared when the decision arrives.

For relations inferred from events rather than explicitly asserted, store provenance and confidence. A model's diagnosis must not silently become a fact.

### The distinction I would enforce

Every MRI observation should have one of three epistemic statuses.

Observed

"Task A has been blocked by decision D since 14:32, and the decision remains unresolved."

Inferred

"The team's current organization may be delaying delivery because decisions from two independent workstreams converge on the same manager."

Proposed

"Moving the second workstream under an existing director may reduce the decision queue without hiring anyone."

This is particularly important because you'll eventually want the morphogenesis machinery to act on MRI findings.

A false diagnosis should never automatically become an unjustified organizational mutation.

## 5. Morphogenesis: what decisions should the organization actually make?

I would avoid designing this as a general LLM prompt that says, "Optimize your team."

That's likely to create more agents, new meetings, and apparent sophistication without corresponding gains in productivity.

Instead, define a small repertoire of organizational transformations.

Your current system already supplies most of the actuators: `hire`, `call_in`, `send_home`, `move`, `assign`, `unassign`, `meet`, `end_meeting`, and `let_go`.

The interesting part is deciding when each transformation has positive expected value.

### Morphogenesis isn't just scaling up and down

It has several dimensions.

Staffing: Which persistent specialists should be active? Should we awaken someone with relevant history, hire a lasting colleague, or use a disposable intern for a one-shot investigation?

Work allocation: Is work assigned to the right context holder? Should a task be split, moved, or kept with one owner to avoid integration overhead?

Topology: Do existing workstreams have enough independence to justify separate managers? Are reporting boundaries aligned with the actual decision domains?

Authority: Which decisions genuinely need escalation? Could more reversible, low-risk decisions be made locally without weakening the runtime's security rules?

Process: Does this problem require independent review, a branch tournament, a simple deterministic check, or no additional process at all?

The last two are especially promising because they can improve throughput without adding personnel.

### Organization shapes should depend on two important properties

A surprisingly effective first approximation might classify work by its decomposability and epistemic risk.

|                                  | Lower uncertainty / risk                         | Higher uncertainty / risk                                                                    |
| -------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Low coupling, naturally parallel | Small independent work cells, simple integration | Independent investigation, parallel alternatives, adversarial verification                   |
| High coupling, shared decisions  | Single strong owner, minimal coordination        | Architectural lead, independent challenger, bounded implementation and rigorous verification |

This gives you sensible default organizational archetypes without committing to rigid orchestration templates.

A tiny bug fix is high-locality, low-risk work. One engineer with an acceptance test is probably enough.

An architectural migration is high-coupling and high-risk. A strong owner and independent challenger may be more valuable than adding several implementation agents.

A large number of independent test failures is low-coupling work. Parallel workers may help dramatically.

And a novel research problem might benefit from several independent investigators even before implementation starts.

The dimension that determines whether parallelism helps is not task size alone. It's how independently useful the resulting work can be.

### Optimizing authority is different from optimizing communication

Suppose a database specialist repeatedly answers questions from several application engineers.

You could move all those engineers under that specialist.

But that might be exactly the wrong intervention.

The specialist may need to share expertise, not manage people. Making them a manager adds staffing, reporting, and accountability responsibilities that distract from their scarce expertise.

Instead, you might recognize the specialist as the designated decision owner for a particular interface while leaving the reporting hierarchy untouched.

This suggests modeling three separate concepts:

| Concept            | Meaning                                                      |
| ------------------ | ------------------------------------------------------------ |
| Reporting manager  | Accountable for people, staffing, priorities, and escalation |
| Task owner         | Accountable for delivery of a specific outcome               |
| Decision authority | Allowed to resolve a bounded class of decisions              |

They can be the same person, but they do not have to be.

I would keep actual tool permissions in your runtime and role system. A task-level decision delegation shouldn't magically give an advisory-only role permission to edit files or perform external writes.

This is where your simplified human-organization metaphor could become more efficient than the human original.

## 6. How a morphogenetic controller should work

I would separate observation, diagnosis, planning, authorization, and execution.

OUTER ORGANIZATIONAL CONTROL LOOP

Runtime state and events

Sessions · Tasks · Threads · Costs · Outcomes

MRI projector

Queues · Dependencies · Context locality · Risk

Pressure detection and diagnosis

What's actually constraining delivery?

Candidate organizational changes

Cheapest viable intervention first

Policy and authority gate

Permissions · Risk · Preconditions · Approval

Existing runtime commands

Apply · Observe receipts · Evaluate outcome

New observations inform the next decision.

This does not require a separate continuously running LLM.

The MRI can incrementally maintain inexpensive projections from runtime events. More expensive diagnosis can happen when a meaningful pressure signal crosses a threshold, when a manager sweeps, or when someone requests it.

The manager remains the accountable actor. The controller produces evidence and possible interventions.

### The optimizer should prefer minimal interventions

Consider a task waiting on verification.

The cheapest response might be to call in the existing test operator.

If that person is already busy, perhaps a temporary read-only peer can perform the check.

If verification demand remains high across many tasks, a lasting specialist might make sense.

If multiple independent verification streams create a sustained decision bottleneck, only then might another managing role be warranted.

The principle is to search an ordered intervention space, not jump immediately to structural change.

A useful decision rule is:

$$
\mathbb{E}[\text{benefit of change}] - \mathbb{E}[\text{transition cost}] > \delta
$$

Where $\delta$ is a margin that makes the system resistant to uncertain or marginal improvements.

But I'd go further: introduce hysteresis.

An organization should not move people every time the inferred optimum changes.

Make structural changes require sustained pressure, a credible improvement hypothesis, and sufficient expected benefit over a meaningful stability horizon.

The controller should be able to say:

"I see inefficiency, but the expected benefit of restructuring does not justify the disruption."

That restraint is a core capability, not a failure to optimize.

### Organizational changes should be proposed as patches

This is one of the ideas I most strongly recommend building.

Instead of an agent saying, "I'm going to reorganize the team," make it produce an explicit change plan.

Conceptually:

```ts
interface OrgPatch {
  organization: string;
  basedOnEventSeq: number;

  objective: string;
  diagnosis: DiagnosisRef;
  expectedEffects: EffectEstimate[];

  actions: OrgAction[];

  preconditions: OrgPrecondition[];
  approval: ApprovalPolicy;
  rollback: RollbackPlan;
}
```

An example patch might be:

> Diagnosis: The coordinator's unresolved architecture decisions are blocking three implementation tasks. The same two engineers also repeatedly require each other's input.

> Proposal: Create a director-of-engineering role for that workstream, move the two engineers under it, retain the architecture specialist as an independent adviser, and leave cross-team mail unrestricted.

> Expected result: Less root-level decision traffic and fewer delays on the affected tasks, at the cost of one additional persistent manager and its context acquisition.

This becomes a reviewable, auditable organizational diff.

Importantly, applying it isn't necessarily one atomic operation. Your existing runtime commands have individual receipts, and a multi-step reorganization can partially fail.

I would therefore execute patches as a small saga: check preconditions, apply each command with stable idempotency keys, verify observed state after each consequential step, and stop or compensate if assumptions no longer hold.

The `basedOnEventSeq` is useful for detecting stale proposals. It shouldn't imply the runtime already provides atomic compare-and-swap semantics for a whole organization—that would be a new capability.

The resulting machinery would be equally usable through a future tmux command, a manager tool, or Agent World's visual interface.

## 7. The most interesting part: learning organizational policies

This is where MRI and morphogenesis become more than a collection of heuristics.

The organization needs to retain evidence about the effectiveness of its own previous configurations.

Imagine recording an organizational episode whenever a meaningful outcome is completed.

It includes the problem characteristics, the personnel and topology used, coordination patterns, context costs, interventions, actual verification evidence, delivery time, and any later discovered regressions.

Not every message. Not the entire transcript.

A compact record of the organization and what happened.

### An organizational policy memory

Problem class: data migration with schema compatibility risk

HISTORICALLY SUCCESSFUL PATTERN

One implementation owner

Maintains coherence of changes

Independent database reviewer

Attacks migration safety

Test/CI specialist

Builds reproducible verification

Coordinator on exceptions

Resolves scope and authority

Illustrative learned pattern, not a measured result from the repository.

The critical observation is that the organization might learn that adding more implementation engineers was counterproductive because the work had high integration coupling.

For a different class of tasks, it might learn that parallelism produced a large improvement.

Eventually, staffing decisions become conditioned on actual historical evidence.

### I would not start with reinforcement learning

The tempting architecture is a contextual bandit or reinforcement-learning controller that optimizes organizational actions.

I would resist that initially.

Your feedback is delayed, sparse, noisy, and heavily confounded. Successful outcomes may depend on model variation, task difficulty, available context, or operator assistance rather than organizational topology.

A policy that always chooses one engineer might appear efficient simply because it was tested mostly on easy tasks.

I'd begin with explicit heuristics, recorded predictions, and retrospective comparisons.

Then use your existing `branch-search` machinery to run controlled experiments where different organizational structures attempt comparable bounded work in isolated environments.

Once you have enough evidence across task classes, a contextual policy selector becomes plausible.

The important distinction is that the system should learn which organizational decisions work under which conditions, not train itself to generate ever more elaborate organizations.

The outcome metric should be verified, risk-adjusted value delivered—not PR count, agents hired, or tasks closed.

And later regressions should be attributable to the episode that produced the change, or else the optimizer will systematically reward fast but fragile delivery.

## 8. An end-to-end example

Suppose you ask the organization to migrate a substantial data-processing service while maintaining compatibility.

Initially, the coordinator assigns an engineer, wakes a database specialist, and recruits an independent reviewer.

After some work, the organization begins to stall.

ILLUSTRATIVE MRI DIAGNOSIS

## Migration blocked by decision concentration

# 3

Tasks waiting on one decision

# 47m

Oldest unresolved dependency

# 2

Overlapping investigations

Diagnosis

Three implementation tasks depend on the same schema decision. Two engineers are independently researching the compatibility contract while the assigned specialist has already produced relevant evidence.

Suggested action

Have the database specialist resolve the bounded technical decision, share its recorded evidence with both engineers, and keep the reporting hierarchy unchanged.

All values are hypothetical to illustrate the desired diagnostic output.

This is where the design becomes particularly interesting.

A naive organizational optimizer might hire another engineer because there is unfinished work. A more sophisticated one might hire another manager because several agents are blocked.

But the MRI suggests that neither is justified.

The structural problem isn't insufficient labor. It's poor decision routing and poor knowledge locality.

Fixing those may unblock the entire critical path without changing headcount or hierarchy.

Now suppose the same pattern recurs across five independent migrations, each involving a separate set of developers who repeatedly need specialized database decisions.

At that point, the organization might propose establishing a durable database migration team with its own manager and practices.

The organization evolves because persistent patterns in the work justify the change, not because an agent feels a bigger team would be useful.

That is the morphogenesis behavior I'd want.

## 9. A practical implementation architecture for apple-pi

I would preserve the existing runtime as the system of record, and build three layers around it.

### Layer A: Organizational telemetry and derived state

Introduce a module adjacent to `components/session-state` that reads the event stream and materializes organizational measurements.

It should be incremental and deterministic wherever possible.

The first pass can exploit the existing database: cost deltas, session lifetimes, work focus, tool durations, threads, escalations, team membership, and manager transfers.

Extend the runtime only for the missing facts that are essential for causal attribution, particularly task dependencies, blockers, decision resolution, and verification evidence.

For tool and model costs, attribution needs care. The existing runtime observes cumulative session cost; attributing a delta to the focused task is an estimate unless you record the corresponding focus and work context at the appropriate execution boundary.

I'd make uncertainty explicit rather than quietly turn that estimate into precise accounting.

### Layer B: Diagnosis and planning

A separate component computes organizational pressures and can invoke an agent to reason about ambiguous cases.

Its responsibilities are determining whether a signal is genuinely harmful, identifying plausible causes, and generating candidate interventions.

It should produce structured diagnostic records with evidence references, confidence, affected tasks, and possible remedies.

Then an organizational planner proposes a patch using existing runtime capabilities.

This separation allows the MRI to be useful even if morphogenesis is disabled.

### Layer C: Authorized control and evaluation

The runtime validates organizational actions, enforces permissions, and records outcomes.

Reversible, low-risk operations can gradually gain greater autonomy. Structural or externally consequential changes remain subject to suitable authorization.

After each intervention, the MRI evaluates whether the predicted improvement occurred.

I would store both the prediction and the observed result. An optimizer that cannot be evaluated is eventually just another expensive agent expressing opinions.

### Both tmux and Agent World consume the same interfaces

The substrate could expose capabilities conceptually like these (proposed, not existing commands):

PROPOSED OPERATOR INTERFACE

```
/org diagnose
/org diagnose --task <task-id>
/org pressures
/org propose
/org plan <proposal-id>
/org apply <proposal-id>
/org history
```

Managers could also call a more narrowly scoped diagnostic tool without requiring your participation.

Agent World could visualize the same diagnosis as highlighted rooms, dependency edges, queued decisions, and before/after topology proposals.

The primary investment remains in the underlying organizational intelligence. The UI is simply a more intuitive way to inspect and govern it.

## 10. The roadmap I would actually pursue

I'd use four phases, with measurable evidence that each phase delivers value before advancing.

| Phase                               | Deliverable                                                                    | Success criterion                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| I. MRI baseline                     | Read-only organizational pressure reports from existing facts and events       | Diagnoses explain real, independently confirmable inefficiencies       |
| II. Causal MRI                      | Blocking relationships, attribution, verification, and outcome tracking        | Can identify critical-path causes rather than just correlated activity |
| III. Controlled morphogenesis       | Proposed organizational patches with safe execution and monitoring             | Reversible interventions measurably improve appropriate outcomes       |
| IV. Learned organizational policies | Reusable staffing and topology patterns conditioned on problem characteristics | Outperforms fixed staffing heuristics on held-out task classes         |

I would start with a narrow objective: identify and reduce avoidable coordination delay per verified outcome.

That gives you a concrete signal without requiring every possible measure of quality, cognition, and human attention to be perfectly solved up front.

As evidence accumulates, expand into context locality, decision authority, and adaptive topology.

## 11. The deeper research thesis

I think there's a genuinely important conceptual opportunity here.

Traditional orchestration chooses which agent performs which task.

Your substrate could eventually choose:

What arrangement of persistent knowledge, decision authority, communication relationships, and independent reasoning produces the best result for this class of work?

That's a different kind of system.

And it leads to several surprisingly strong principles.

A manager is valuable only when it reduces more cognitive and coordination load than it introduces.

A specialist is valuable not only for what it can reason about, but for the accumulated context others would otherwise have to reconstruct.

A communication channel is valuable insofar as it reduces uncertainty or prevents errors, not because it increases collaboration.

Parallelism is valuable when it reduces the critical path or increases independent evidence more than it increases merging and integration costs.

And organizational stability is valuable because persistent people accumulate useful context over time.

I would summarize the central design principle as:

> Treat organizational structure as a dynamically optimized arrangement of context, authority, and computation—while keeping the work, evidence, and human objectives as the stable reference points.

One particularly interesting consequence is that the best organizational intervention often doesn't add a person or change a reporting line. It removes a dependency, routes a decision locally, preserves context, or eliminates unnecessary communication.

That's the kind of self-optimization I would want `apple-pi` to discover.

And it's a considerably more fundamental advance than making the visual world more elaborate: Agent World would become the window into a software organization that is learning not only how to write software, but how to organize intelligence to write software well.
