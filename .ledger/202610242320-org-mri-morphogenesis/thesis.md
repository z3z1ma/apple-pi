# Thesis: fitness-driven self-organization (2026-10-24), verbatim

The operator's revised framing, given after reading what the brief says about fitness. Where it differs from the brief ([source.md](source.md)), this thesis wins. Only math delimiters were normalised.

---

I think this clarification gets us substantially closer to the right abstraction. And I want to correct something from my earlier framing: I was too quick to move away from a scalar fitness function.

What you're describing is more fundamental and, potentially, much simpler than the architecture I was proposing.

You're not primarily trying to build an organizational diagnostic system that recommends changes. You're trying to give the organization a measurable objective it can optimize, along with the means to evaluate itself and change itself.

The MRI, morphogenesis, organizational memory, and adaptive coordination can all emerge around that objective.

I would now express the central idea as:

> An organization of agents has a fitness. That fitness can be evaluated, decomposed, compared across organizational configurations, and improved through changes to the organization.
>
> The system should provide the smallest set of primitives that makes this possible, rather than prescribing how an intelligent organization must optimize itself.

There are several important implications, including a few places where I would not adopt the other agent's interpretation wholesale.

## 1. The scalar is fundamental, not a lossy dashboard summary

I agree with your desire for a genuine function:

$$ F(\mathcal O)\rightarrow\mathbb R $$

Not just six metrics displayed together. Not a qualitative judgment disguised as a score. And not a system where a separate agent opines on whether an organization looks healthy.

A scalar creates an optimization landscape. It gives us a way to compare organizational states and ask whether particular changes appear beneficial.

The function can absolutely be composed from many individually meaningful terms:

$$ F(\mathcal O)= f_1(\mathcal O)+f_2(\mathcal O)+\cdots+f_n(\mathcal O) $$

The components can have weights, transformations, interactions, and normalization. There's nothing inherently wrong with reducing measurements in different units to one scalar. That's what utility functions do.

What matters is that their composition is intentional and has meaningful semantics.

We want both the scalar and the decomposition. The scalar drives optimization; the decomposition makes its behavior intelligible.

I would also distinguish the fitness definition from our ability to estimate it accurately. A mathematically well-defined scalar objective doesn't imply that all of its inputs are immediately observable or that hypothetical future outcomes can be predicted precisely.

That distinction is going to matter enormously for hill climbing.

## 2. One refinement: fitness depends on the work and environment

I would make one adjustment to the notation:

$$ \boxed{F(\mathcal O;\mathcal W,H)\rightarrow\mathbb R} $$

Where:

- $\mathcal O$ is the organizational configuration: people, persistent contexts, roles, reporting structure, assignments, and so on.
- $\mathcal W$ is the work the organization is expected to accomplish, or a distribution of incoming work.
- $H$ is the time horizon over which we're evaluating its effectiveness.

The organization doesn't have an entirely intrinsic fitness independent of what it's supposed to accomplish.

The same team might be extraordinarily fit for a distributed-systems migration and terribly inefficient for a series of trivial frontend changes.

That's precisely why morphogenesis matters.

The fitness landscape changes as the workload changes.

This also solves a nasty degeneracy: an organization that dismisses everyone, performs no work, and consumes no tokens shouldn't be considered maximally fit when there is valuable unfinished work.

The external work provides the demand against which organizational effectiveness is judged.

## 3. I would start with a simpler fitness equation

I'd start from something almost embarrassingly simple:

$$ \boxed{F=\text{Expected Useful Value}-\text{Expected Total Cost}} $$

Everything else is a refinement of those two concepts.

An illustrative expansion is:

$$ F_\theta(\mathcal O;\mathcal W,H) = \underbrace{\widehat V(\mathcal O,\mathcal W,H)}_{\text{useful output}} - \underbrace{\widehat C_\theta(\mathcal O,\mathcal W,H)}_{\text{total cost}} $$

Where useful output can account for completion, quality, priority, and timeliness, and costs can account for compute, human attention, failures, and organizational disruption.

The parameters $\theta$ determine how different costs and values are combined into the common fitness scale.

I would not require the operator to manually select six weights. The other agent's suggestion to do so introduces an implementation and product decision you haven't made.

We need a coherent objective with intelligible parameters. Those parameters might be defaults, inferred from the work's priorities, globally configured, or explicitly adjusted when useful.

There is another important simplification here.

### Coordination and context fragmentation need not be independent penalties

Suppose two agents exchange 15 messages and solve a complex architectural question.

Should the organization be penalized for 15 messages?

Not intrinsically.

Those messages consumed inference, time, and perhaps human attention. But they may have prevented expensive rework.

Likewise, context fragmentation doesn't necessarily deserve an independent weighted penalty if its consequences are already represented in inference cost, delay, and output quality.

Otherwise we risk double counting the same underlying inefficiency.

This is where I would distinguish the fitness function from the MRI.

| Fitness function                  | Organizational MRI                                  |
| --------------------------------- | --------------------------------------------------- |
| Measures net effectiveness        | Explains causes of effectiveness or inefficiency    |
| Produces a scalar                 | Exposes contributing measurements and relationships |
| Supports comparing configurations | Helps identify promising modifications              |
| Represents what is valuable       | Reveals what is consuming or producing that value   |

For example, repeated context rehydration might explain unusually high inference expenditure. We don't necessarily need both a context-fragmentation penalty and an inference-cost penalty.

Similarly, heavy communication might be highly beneficial in high-risk work and wasteful in routine work.

The fitness function should reward the consequences we care about. The MRI should explain the mechanisms producing those consequences.

This division is potentially simpler and more expressive than manually specifying penalties for every undesirable organizational behavior.

## 4. The really important distinction: actual versus prospective fitness

Here's where I think a little precision saves us considerable architectural complexity later.

Consider two questions:

How fit was this organization over the last hour?

We have observations. We can compute a scalar from the work produced, resources consumed, delays, and whatever outcome evidence exists.

How fit would this organization become if we moved two agents under another manager?

We haven't performed that change. Its future effects are unknown.

We can estimate the same objective, but we cannot measure the counterfactual directly.

So I'd distinguish:

$$ F_{\text{observed}} \qquad\text{and}\qquad \widehat F_{\text{predicted}} $$

These are not competing fitness definitions. They are observed and estimated evaluations of the same underlying objective.

This creates a very natural learning loop.

1. Evaluate current fitness: observed organization and available outcomes.
2. Consider a structural mutation: hire, move, reassign, wake, delegate, retire...
3. Estimate the change in fitness: $\widehat{\Delta F}=\widehat F(\mathcal O')-\widehat F(\mathcal O)$
4. Execute a promising mutation through existing organizational commands.
5. Measure what actually happened.
6. Use the result to improve subsequent estimates.

This supports hill climbing without requiring a perfect simulator of organizational behavior.

The estimate can initially be quite rudimentary. It may even involve an agent reasoning over recent observations and the fitness components.

As experience accumulates, the system can develop better estimates.

One subtlety: some valuable organizational changes initially reduce observed fitness.

Hiring a specialist consumes resources before producing anything. Reorganizing a team imposes a temporary coordination cost. Sharing context may cost more today but avoid extensive duplicated work tomorrow.

Therefore, hill climbing should evaluate expected fitness over an appropriate horizon, not require every immediate state transition to increase a short-term score.

That distinction allows organizational investments to be rational.

It also means that a single candidate mutation may be a short composition of existing operations rather than one isolated action. You don't necessarily need a new orchestration framework to express that.

## 5. I want to push back on computing the same fitness for arbitrary subtrees

The other agent identified fitness for subsets of the organization as one of the two genuinely new ideas.

I agree that local evaluation is important.

But I would not immediately make an independently evaluated fitness score for every person, team, and subtree a core requirement.

There's a subtle mathematical problem.

Imagine a security specialist who doesn't deliver any implementation tasks but prevents defects across five teams.

Evaluating the specialist in isolation might produce an extremely poor fitness score: expensive inference, many conversations, little directly attributable output.

But removing the specialist could dramatically reduce global organizational fitness.

The same problem applies to managers, architects, and integrators.

Their value is often expressed through the performance of other people.

### A potentially cleaner abstraction: marginal fitness

Start with one authoritative organizational fitness function.

Then ask how a change to a subset affects the whole:

$$ \boxed{ \Delta F(m)=F(m(\mathcal O))-F(\mathcal O) } $$

Here, $m$ is an organizational mutation.

It might change one agent's assignment, move a team, hire a reviewer, or alter the reporting topology.

This naturally accommodates nonlocal effects.

A change can improve one team's throughput but worsen the organization's integration costs. The fitness delta captures both—assuming our evaluator can estimate those consequences adequately.

It also avoids requiring us to invent an independent local utility function for every organizational level.

Locality becomes a property of the proposed change, not a requirement to score every person separately.

We can still decompose the global fitness for explanation or efficiently recompute the affected portions when possible.

But attribution and marginal contribution are different things.

I think this distinction is worth protecting.

## 6. Morphogenesis should be a search over legal organizational mutations

This is where your existing substrate becomes particularly elegant.

You already have the machinery for modifying organizations.

The role catalog defines possible kinds of personnel. The organization tracks existing members. The runtime provides hiring, reassignment, transfer, dormancy, and retirement.

Rather than introduce an organizational compiler, a bespoke controller, and a new workflow language, what if we simply expose:

MINIMAL CONCEPTUAL PRIMITIVES

| Primitive | Meaning                                         |
| --------- | ----------------------------------------------- |
| Observe   | Read organizational state and recent activity   |
| Evaluate  | Compute scalar fitness and its components       |
| Mutate    | Use existing authorized organization operations |
| Compare   | Estimate or measure fitness differences         |

That's remarkably little conceptual machinery.

The intelligence that searches this space can live in an existing manager agent. It can reason about which mutations to try, use `pi_exec` where helpful, and act through the same tools already available to it.

The substrate need not prescribe how the search works.

One manager might perform greedy local search. Another could explore several alternatives. Another could adopt a relatively stable configuration and only reconsider it when fitness deteriorates.

That freedom matters.

We should make self-organization possible, not encode one theory of self-organization into the runtime.

Even the "try the cheapest intervention first" heuristic from my prior proposal shouldn't become a fundamental rule. The fitness function itself can account for mutation costs, letting an agent choose a more expensive intervention when the expected payoff warrants it.

Likewise, explicit hysteresis thresholds, approval workflows, and reorganization schemas are not prerequisites for the core abstraction.

Your existing runtime's permissions and role boundaries remain enforceable invariants. But that's different from constructing an additional verification bureaucracy around fitness optimization.

## 7. What Organizational MRI becomes in this framing

I like the term MRI even more now, but its role changes.

Rather than a separate diagnostic subsystem that we must hand-design with seven organizational health metrics, it's the introspective surface of fitness evaluation.

Imagine the function produces (illustrative scoring units and values):

| Current fitness | +42.6 |
| --- | --- |
| Expected useful output | +100.0 |
| Compute and tool expenditure | -24.0 |
| Delivery delay | -16.0 |
| Human attention | -9.0 |
| Failure and change costs | -8.4 |

But that's just the first level of introspection.

The more interesting questions are:

"Why is delivery delay so high?"

"Which relationships in the current organization are contributing most to it?"

"What mutations would most improve fitness?"

This suggests an especially appealing conceptual unification:

MRI describes the fitness landscape around the current organization. Morphogenesis navigates it.

In continuous optimization, you'd investigate gradients.

Here, the organization is discrete and combinatorial, so you're exploring neighboring configurations and finite differences.

The MRI can expose promising directions of change based on those finite differences.

It doesn't need a separate ontology of organizational illnesses.

We might discover recurring patterns—bottlenecks, excessive fan-in, context fragmentation, over-parallelization—but those are explanatory interpretations of what makes fitness move.

They needn't become permanent special cases in the underlying implementation.

## 8. The simplicity constraints I would carry into the specification

Here's what I would explicitly resist introducing prematurely.

| Earlier idea                                             | My revised position                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------ |
| Dedicated organizational compiler                        | Not necessary for the basic fitness-driven organization            |
| Separate diagnostic and planning engines                 | Potentially useful later; not fundamental                          |
| Independent per-agent and per-team fitness functions     | Prefer global fitness and marginal contributions                   |
| Prescribed intervention hierarchy                        | Let candidate mutations compete on fitness                         |
| Mandatory operator-chosen weights                        | Define a coherent objective; keep parameterization flexible        |
| New verification pipeline for each organizational change | Use existing outcome evidence and runtime invariants               |
| Complex policy-learning system                           | Start with evaluation and feedback; let learning emerge from usage |
| Custom organizational workflow language                  | Compose existing manager operations                                |

That doesn't mean these mechanisms can never become useful. It means the initial specification shouldn't make them necessary to express the core idea.

I would also avoid prematurely committing to a fixed number of fitness components.

An implementation could make individual terms composable, allow nonlinear transformations, and expose the resulting scalar and contributing values.

Adding a new measurement wouldn't require redesigning the optimizer.

And I'd exploit your existing event log, assignments, threads, cost measurements, and manager history before introducing more state. Add instrumentation only where a specific missing fact prevents meaningful evaluation.

The most important test of the design is not how little code it contains, but whether complex organizational behavior can be expressed by composing a small set of understandable primitives.

## 9. The formulation I'd take back to the other agent

Working thesis — Fitness-driven self-organization

An organization of persistent agents has a scalar fitness, evaluated relative to the work it is expected to accomplish and a time horizon. The function composes meaningful measurements of useful output and cost into one objective.

Organizational MRI is the ability to evaluate and introspect that fitness: its components, contributing relationships, historical changes, and sensitivity to organizational mutations.

Organizational morphogenesis is the ability to search over changes to the organization's configuration and act to improve expected fitness. Its operations should compose the existing primitives for staffing, assignment, reporting, and agent lifecycle.

The system must distinguish observed fitness from estimates of hypothetical configurations and use subsequent experience to improve those estimates.

The global fitness objective is primary. Local evaluation is expressed through contributions and marginal changes to global fitness, without requiring independent utility functions for every person or team.

The implementation should maximize expressivity and composability with minimal new machinery. It should enable adaptive organizational behavior rather than encode a predetermined organizational optimizer.

## 10. The one conceptual question I think we should resolve next

There's a genuinely important fork here, and I don't want to smuggle my preference into the specification.

Is fitness primarily a measurement of an organization's productive output, or a measurement of its intrinsic capacity to produce output?

These overlap, but they aren't identical.

A team of experienced agents asleep at the inn might be producing nothing and costing almost nothing, yet possess tremendous latent capability. An organization that is currently delivering work may be highly productive but fragile, with no spare capacity and all knowledge concentrated in one agent.

One framing evaluates realized net value over a period. The other evaluates expected future value under some workload.

My instinct is that expected future net value is the more fundamental fitness definition, with realized outcomes providing the observations from which we learn to estimate it.

That would allow the function to assign real value to persistent knowledge, available capacity, and beneficial organizational structure without inventing separate "organizational health" bonuses.

But the difficult part is estimating that latent value.

I think resolving that distinction—how much fitness reflects what has been produced versus what the current organization is capable of producing next—will unlock the cleanest specification.
