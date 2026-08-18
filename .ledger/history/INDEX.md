# Task History

- `.ledger/history/202608181148-advisor-ux-reviewing-state-footer-bordered-advisory-card/task.md` — done — Advisor UX: reviewing-state footer + bordered advisory card — Implemented persistent footer reviewing/idle state and a bordered severity-colored advisory card (done). Also parks a detailed research record on pi-advisor's non-blocking steer/deferred/followUp delivery model for a future architectural decision.

- `.ledger/history/202608181322-account-sidecar-model-usage/task.md` — done — Account for advisor and memory sidecar model usage — Emit durable per-call usage/cost records for advisor and observational-memory model calls so per-provider quota spend is measurable; today ~100% of sidecar spend is invisible.

- `.ledger/history/202608181322-merge-memory-consolidation-pass/task.md` — done — Merge memory consolidation into one curation pass — Observer, reflector, and dropper run as up to three sequential model calls re-sending overlapping input; merge them into one curation pass with coverage tiers and drop budget recomputed against post-record state rather than a pre-loop snapshot.
