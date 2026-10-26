# Prior art: adapting organization structure to the work

A research intern gathered these on 2026-10-24. Citations are as the intern returned them; the root did not open each paper. Treat the 2026 preprints as preliminary.

## LLM multi-agent structure

| Work | Finding | Evidence | Citation |
| --- | --- | --- | --- |
| GPTSwarm | Agents as graphs; prompts and edges optimized | Benchmark | Liu et al. 2024, arXiv:2402.16823 |
| AFlow | MCTS over executable workflows | Benchmark | Zhang et al. 2024, arXiv:2410.10762 |
| ADAS | A meta agent writes and evaluates agent programs | Benchmark | Hu et al. 2024, arXiv:2408.08435 |
| DyLAN | Agent selection by importance score from trial runs; dynamic communication | Benchmark | Liu et al. 2023, arXiv:2310.02170 |
| AgentVerse | Group composition changes while the task runs | Benchmark | Chen et al. 2023, arXiv:2308.10848 |
| MetaGPT, ChatDev | Fixed roles and SOPs beat naive chaining | Benchmark | arXiv:2308.00352, arXiv:2307.07924 |
| MaAS | Query-dependent architecture from a supernet; quality against cost | Benchmark | Zhang et al. 2025, arXiv:2502.04180 |
| MAST | 14 failure modes from 1,600+ traces: design, inter-agent misalignment, verification | Trace study | Cemri et al. 2025, arXiv:2503.13657 |
| Agent-count scaling | Non-monotonic returns; homogeneous agents saturate; diversity matters | Benchmark (preprints) | arXiv:2602.03794, arXiv:2606.00655 |

## Human organization design

| Work | Finding | Evidence |
| --- | --- | --- |
| Conway, mirroring hypothesis (MacCormack, Baldwin, Rusnak 2012; Colfer, Baldwin 2016) | Communication structure shapes architecture; mirroring is conditional | Field and case studies |
| Galbraith 1974 | Organizations either add information-processing capacity or reduce the need for it (slack, rules, decomposition) | Theory |
| Brooks 1975 | Adding people to a late project makes it later: onboarding and communication | Practice |
| Team Topologies (Skelton, Pais 2019) | Cognitive load per team; interaction modes (collaboration, as-a-service, facilitating) | Practice |
| Reinertsen 2009 | Queues dominate lead time; manage cost of delay and work in progress, not utilization | Theory and practice |

## Transfer to lasting, stateful people

- **Transfers well:** Galbraith (reduce the need for coordination before you add capacity; this matches "cheapest intervention first"), Brooks (cold start cost of a hire), Reinertsen (measure waiting and queues, not utilization), Team Topologies (interaction modes are a vocabulary for "specialist advises, does not manage"), MAST (a failure taxonomy to label diagnoses).
- **Transfers partly:** the LLM topology-search work optimizes per query with disposable agents and a benchmark judge. None of it values continuity, accumulated context, or the cost of reorganizing lasting people.
- **Gap:** no study found compares lasting, stateful agent organizations over weeks with disposable per-query teams, or measures the value of reusing a warm person. Apple-pi's own history is the evidence source for that.
