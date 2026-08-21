# Task History

- `.ledger/history/202608181148-advisor-ux-reviewing-state-footer-bordered-advisory-card/task.md` — done — Advisor UX: reviewing-state footer + bordered advisory card — Implemented persistent footer reviewing/idle state and a bordered severity-colored advisory card (done). Also parks a detailed research record on pi-advisor's non-blocking steer/deferred/followUp delivery model for a future architectural decision.

- `.ledger/history/202608181322-account-sidecar-model-usage/task.md` — done — Account for advisor and memory sidecar model usage — Emit durable per-call usage/cost records for advisor and observational-memory model calls so per-provider quota spend is measurable; today ~100% of sidecar spend is invisible.

- `.ledger/history/202608181322-merge-memory-consolidation-pass/task.md` — done — Merge memory consolidation into one curation pass — Observer, reflector, and dropper run as up to three sequential model calls re-sending overlapping input; merge them into one curation pass with coverage tiers and drop budget recomputed against post-record state rather than a pre-loop snapshot.

- `.ledger/history/202608201212-upgrade-ralph-pi-exec-templates/task.md` — done — Bring Ralph templates to pi_exec standard-library quality — Adapt pi-ralph references and both skill guides to use the shared pi_exec std library with deliberate templates and coverage checks.

- `.ledger/history/202608202232-redesign-input-area-information-layout/task.md` — done — Redesign the Pi input-area information layout — Replace apple-pi's default footer composition with a responsive, status-preserving custom input-area layout inspired by Zentui and selected Powerline presentation patterns.

- `.ledger/history/202608202235-evaluate-superpowers-ledger-integration/task.md` — done — Evaluate Superpowers integration with Ledger — Study obra/superpowers at main and define an evidence-backed integration path for apple-pi's ledger, skills, Ralph, subagents, and Pi Exec.
