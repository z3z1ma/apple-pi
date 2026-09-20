Status: complete
Created: 2026-09-20
Updated: 2026-09-20

# Retrospective

## What Mattered

The useful seam was one modal owner with domain-contributed sections. This kept command and shortcut registration singular while preserving the existing agent and task detail behavior. Public tests at the extension, modal, and package-loader seams caught both interaction and runtime-integration defects.

## Learnings

Pi gives each loaded extension a distinct `ExtensionAPI` facade, so facade identity cannot coordinate cross-extension singleton state. The shared event bus is the stable integration seam. Wrapper chrome must also reserve its line budget in child rosters; clipping after rendering can hide the selected item.

## Improvements

Keep exact registration-count assertions when several extensions contribute to one feature. Add layout chrome to the child's budget before it chooses its visible window instead of trimming rendered rows afterward.
