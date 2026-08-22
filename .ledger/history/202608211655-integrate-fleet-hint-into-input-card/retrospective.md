Status: complete
Created: 2026-08-21
Updated: 2026-08-21

# Retrospective

## Summary

Fleet navigation guidance now uses the input card's existing footer-status integration and shares the model metadata row instead of consuming a dedicated below-editor row. The Fleet roster begins directly with `main`.

## What Worked

The reserved status key kept producer and consumer ownership separate while reusing Pi's public footer-data boundary. Test-first checks caught the missing producer, duplicate strip placement, narrow-layout behavior, no-model case, and replacement-UI publication. Independent review found the model-absent row before closure.

## What Could Improve

The first implementation treated a hint-only metadata row as a harmless fallback even though the task explicitly required the hint to share model metadata. The initial lifecycle reasoning also discounted replacement-UI publication too quickly; a direct state-transition test was cheaper and more decisive than debating current Pi reachability.

## Learnings

A placement contract such as “opposite model metadata” also defines absence behavior: if the anchor is unavailable, the attached secondary element should disappear rather than recreate the row being removed. UI rebind methods should establish complete replacement state synchronously, not rely on a later timer or caller-side no-op setter.

## Improvements

The user-facing placement and narrow-width behavior are documented in `docs/status-footer.md`. Focused regression tests now protect no-model omission and immediate UI-rebind publication. No additional durable process or architecture document is warranted.
