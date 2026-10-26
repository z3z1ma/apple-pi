# Map: Organizational MRI and morphogenesis

## Destination

A locked architecture decision for fitness-driven self-organization: the organization's scalar fitness and the smallest set of primitives (observe, evaluate, mutate, compare) that let it evaluate and improve itself, ready for `/skill:to-spec`.

## Notes

- The brief, verbatim in [source.md](source.md), is true in intent. The operator, 2026-10-24: follow it verbatim; it is a bet; the data speaks over the coming months but does not gate the work now.
- The operator, 2026-10-24: simplify the physical implementation aggressively and reject complexity in every form; defer anything focused on verification; decide from usage, base intelligence, and gut direction. The brief's machinery (three layers, patch sagas, episode records) describes the concept, not a build list.
- The state database is context, not authority: it grew alongside a fast-changing repository and does not show current behaviour.
- Authorities that change where the brief requires it: `docs/organization.md`, `docs/session-state.md`, `docs/boundaries.md`, and the manager charter in `components/organization/src/charters.ts`.
- The operator, 2026-10-24, refining the ruling above: keep the brief's richness and make the implementation simple, with no machinery around it. Cut machinery, never concepts; prefer a generic, naturally extensible shape to a narrow one.
- The operator's thesis, verbatim in [thesis.md](thesis.md), 2026-10-24, is the central framing and wins over the brief where they differ: one scalar fitness F(O; W, H), global with marginal changes instead of per-subset scores; the MRI introspects fitness; morphogenesis searches legal mutations; the substrate does not prescribe the search. No org patch object.
- Docs that the brief contradicts (`docs/boundaries.md` on handoff schemas and tickets beyond tasks, `docs/organization.md`, `docs/session-state.md`, the charter) are updated in the spec, not here.
- Grilling tickets use `interrogate-to-design` and `domain-modeling`.

## Decisions so far

- [Signals from existing history](decisions/01-signals-from-existing-history.md): most signals are computable as proxies; the gap is why a person waits. Context only.
- [Prior art on adaptive agent organizations](decisions/02-prior-art-adaptive-agent-organizations.md): topology search assumes disposable agents; Galbraith, Brooks, Reinertsen, and Team Topologies transfer.
- [Reuse of replay and branch search](decisions/03-reuse-replay-and-branch-search.md): episodes can derive from the ledger bundle and the database; branch search cannot run teams.
- [What better means](decisions/04-what-better-means.md): the brief's weighted objective under hard constraints; superseded by the org fitness function.
- [New runtime facts](decisions/06-new-runtime-facts.md): causal links between existing entities, recorded by people when they matter; inferred links are marked.
- [Where the MRI lives](decisions/07-where-the-mri-lives.md): the MRI is the introspective surface of fitness evaluation; findings are observed, inferred, or proposed.
- [Who reads the diagnosis](decisions/08-who-reads-the-diagnosis.md): one interface for managers, the operator (`/org`), and the views; diagnosis on sweep or request, no standing LLM.
- [Form of an org change](decisions/09-form-of-an-org-change.md): a mutation is a short composition of existing manager operations, judged by its change in fitness; no patch object, no cheapest-first rule.
- [Decision authority](decisions/10-decision-authority.md): reporting manager, task owner, and decision authority are separate; authority never widens permissions.
- [Episodes and learning home](decisions/11-episodes-and-learning-home.md): learn per completed outcome, starting with heuristics, not a learner.
- [Phase gates](decisions/12-phase-gates.md): the four phases stand; build now, judge gates from data as it accumulates.
- [Autonomy ladder](decisions/05-autonomy-ladder.md): managers make every org change on their own judgment, then report with the reasoning; no approval tiers.
- [Minimal physical form](decisions/18-minimal-physical-form.md): the full WorkLink as one generic links table; the four primitives observe, evaluate, mutate, compare; the manager searches in its sweep; principles in the charter; `/org` for the operator.
- [Margins and thresholds](decisions/15-margins-and-thresholds.md): no configured numbers; the manager compares estimated changes in fitness over a horizon.
- [Org fitness function](decisions/19-org-fitness-function.md): one scalar F(O; W, H) = expected useful value minus expected total cost, composable terms, no separate coordination penalties, observed versus predicted, global with marginal changes.
- [Realized or expected fitness](decisions/21-realized-or-expected-fitness.md): fitness is expected net value over H under expected work; realized net value over a trailing window is the ground truth; no health bonuses.
- [Source of useful value](decisions/22-source-of-useful-value.md): the assigner estimates value and cost of delay in task.md, the operator corrects; everything priced in dollars; supersedes takes value back.
- [Record of mutations and outcomes](decisions/23-record-of-mutations-and-outcomes.md): a predicts link from the mutation message holds the predicted change and horizon; realized fitness is recomputed; no snapshots, no new table.
- [Roles and expected fitness](decisions/24-roles-and-expected-fitness.md): roles act by changing outcomes; fitness applies one function to observed history or to weighted scenarios; findings are evidence, not credit; a waste line shows prevention.
- [Hill-climbing loop](decisions/20-hill-climbing-loop.md): managers search legal mutations freely, estimate the change in fitness over a horizon, act, measure, and improve their estimates.

## Not yet specified

## Out of scope

- [What counts as a verified outcome](decisions/13-verified-outcome.md): verification is deferred by the operator.
- [Organization experiments](decisions/17-organization-experiments.md): controlled evaluation is verification work; deferred.
- A reinforcement-learning or bandit controller at the start.
- Decision authority that widens tool permissions.
- Agent World as the home of organizational intelligence: it is a view.
- Implementation: this map ends at an architecture decision.
