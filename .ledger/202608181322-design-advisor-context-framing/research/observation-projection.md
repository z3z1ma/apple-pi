Status: done
Created: 2026-08-18
Updated: 2026-08-18

# Advisor context should be a trajectory projection, not a forwarded transcript

## Question

The shipping lean-delta rule omits `read` / `grep` / `find` / `ls` bodies down to a line
count and truncates every other result, including successful bash. Is that the right
compression, or should the advisor receive a purpose-built projection that keeps
reasoning and action intent while replacing observations with receipts?

## Method

Operator-supplied survey of advisor implementations and 2025–2026 observation-compression
papers (2026-08-18), used as the investigation record rather than re-derived here.
Locally verified Pi tool result shapes in `@earendil-works/pi-coding-agent`
`dist/core/tools/{read,grep,find,ls,bash,truncate}.js` so any receipt can be compiled
from arguments, result text, and `details` the runtime already has. Did not clone
`philipbrembeck/pi-advisor` in this pass.

## Findings

- Across implementations, the expensive class is environment observations / tool
  outputs, not executor reasoning or tool intents. Anthropic's official Advisor
  forwards the full transcript. Pi-ecosystem variants already experiment with
  incremental deltas, disclosure policies, rolling tails, and reversible omission.
- Closest Advisor-specific match: `philipbrembeck/pi-advisor` (Advisor Scout +
  per-tool `full` / `summary` / `exclude`, selected verbatim evidence). Not
  independently re-read in this run.
- Empirical support for attacking observations rather than summarizing the whole
  trace: Complexity Trap observation masking; Squeez verbatim tool-output
  selection; SWE-Pruner task-conditioned line keeping; CoACT next-action
  preservation and compress-before-append; VCC consumer-specific views;
  AgentDiet / ACON / TACO policy search; demand-paging / `pi-context-prune`
  reversible stores.
- Line-count-only exploratory omit is too aggressive for review: the advisor
  must see *what evidence was sought* (query, path, match/file counts, loci,
  truncation), not merely that a payload existed.
- Successful `find` / `ls` listings can be 500–1000 names. Dumping them is still
  an observation dump. Counts plus a short name cap are the receipt.
- Pi bash `details` carry exit / truncation / optional temp path. Duration is UI
  state only and is not on the result. Do not invent it.
- Three independent axes: semantic projection, cache-preserving append transport,
  invocation sparsity. This task already has incremental append transport.
  Sparse invocation is the coalescing sibling, not a new clock.

## Conclusions

Adopt deterministic tool-specific receipts as the v1 advisor view. Keep thinking,
assistant text, and tool arguments verbatim. Compile observation/mutation/
verification results from existing args + body + `details`. Do not add a Scout,
LLM summarizer, typed IR compiler, evidence-handle store, or `expand_observation`
tool in this increment. Recovery remains the advisor's `read` / `grep` / `find`
plus the already-specified primary-bound recall tools.

## Limits

Paper numbers and the Scout implementation were not re-verified against primary
sources in this run. Pi result shapes were. Bash success has no test-runner
classifier; failure keeps a small tail. No replay corpus was built, so
critique-preservation versus full-transcript Advisor is **Not verified**.
