## file

The original/late writer names correspond to explicit roles in the model, not interchangeable production identifiers. The two-writer bound explores watermark invalidation and post-completion cleanup; changing this constant alone does not generalize the actions to arbitrary writers.
Why: increasing a TLC constant can appear to increase coverage while leaving hard-coded role transitions unchanged. Larger-population claims need a model change, not just a larger set.

Deadlock checking is disabled intentionally: cleanup may remain blocked by a live/unknown producer or mismatched header. The named invariants are safety claims; no fairness or eventual-completion property is configured.

Coupled: specs/departure-lifecycle.tla
Verify: tests/lifecycle-models.test.ts
