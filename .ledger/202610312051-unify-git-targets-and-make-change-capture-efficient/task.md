Status: in-progress
Created: 2026-11-01

# Unify Git change selection and improve performance

## Intent

Implement all agreed Git consistency and efficiency changes: one explicit target model (working tree, staged, commit/parent, exact range, branch/merge-base, existing capture reuse) across review, Explain Change, code sign-off and applicable Pi Exec evidence helpers. Share Git resolution/content acquisition without forcing explanations or direct sign-off through asynchronous model review or unnecessary checkout materialization. Use native Git plumbing, batching, immutable identities and demand-driven reads; measure actual costs against equivalent Git operations and optimize demonstrated bottlenecks. Preserve source fidelity, mutation detection, retained review identity and approval boundaries. Update real consumers, tool guidance/docs, focused tests, packaging/builds and activation as required. Inventory every agreed item and report verification and any unresolved limits explicitly; preserve unrelated work.

## Current state

Implemented; see [checklist](checklist.md) and [evidence](evidence.md). One shared target model and Git snapshot module now serve review capture, freshness, code sign-off, Explain Change and Pi Exec evidence. Review capture fell from 23-32 s to about 2.7 s on this checkout, freshness from about a minute to well under a second. Committed as 4a0d52ab and activated: runtime 70285 and app 70795 run it; Pi sessions need /reload. Operator QA pending.

## Outcome

Pending completion.

### Assignment 585: Tadhg Marinescu

Implemented and activated (4a0d52ab, 04fdf939). One shared Git-native change module (components/shared/src/git-change.ts) gives review_code, freshness, sign_off_code, explain_change (new `target` and `review` params) and Pi Exec git_change/git_patch/neighborhood/test helpers (new `target` dict) identical target semantics. Capture: 22.8–31.8 s → ~2.7 s on this checkout; freshness 57.8 s → 284 ms live; page diffs read exact tree bytes. Verified: final focused cohort 21 files/207 tests, Agent Workplace backend/build, loader, typecheck, Biome, context lint, isolated Electron check, benchmark across four repo shapes. Reproduced/fixed racy-index copy and clean-filter hazards. Limits: preview still full capture; first full verify re-hashes racy files; materialization scales with tree; full suite and paid review not run. Operator QA pending; Pi sessions need /reload.
