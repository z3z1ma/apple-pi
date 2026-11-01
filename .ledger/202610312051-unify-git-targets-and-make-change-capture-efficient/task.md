Status: in-progress
Created: 2026-11-01

# Unify Git change selection and improve performance

## Intent

Implement all agreed Git consistency and efficiency changes: one explicit target model (working tree, staged, commit/parent, exact range, branch/merge-base, existing capture reuse) across review, Explain Change, code sign-off and applicable Pi Exec evidence helpers. Share Git resolution/content acquisition without forcing explanations or direct sign-off through asynchronous model review or unnecessary checkout materialization. Use native Git plumbing, batching, immutable identities and demand-driven reads; measure actual costs against equivalent Git operations and optimize demonstrated bottlenecks. Preserve source fidelity, mutation detection, retained review identity and approval boundaries. Update real consumers, tool guidance/docs, focused tests, packaging/builds and activation as required. Inventory every agreed item and report verification and any unresolved limits explicitly; preserve unrelated work.

## Current state

Implemented; see [checklist](checklist.md) and [evidence](evidence.md). One shared target model and Git snapshot module now serve review capture, freshness, code sign-off, Explain Change and Pi Exec evidence. Review capture fell from 23-32 s to about 2.7 s on this checkout, freshness from about a minute to well under a second. Activation (Pi /reload, runtime and app restart) follows the commit.

## Outcome

Pending completion.
