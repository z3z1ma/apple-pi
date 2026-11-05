Status: done
Created: 2026-11-04
Updated: 2026-11-04

# Retrospective

## What Mattered

- A dedicated id/state reader made the badge cheap enough to poll before the app is opened; reusing the queue would have built every review's summary every two seconds.
- Recording a baseline on first run kept the badge from starting at every historical review.
- Screenshots caught what assertions did not: a scoped `.wp-reviews button` reset outranked the new button classes, enlarging toolbar buttons and putting light text on the light dark-mode accent.

## Learnings

- Adding a seventh rail app pushed Reviews under More at a 900px window; the first test run timed out on the rail button. Check the rail's real capacity whenever an app is added.
- Biome flags custom `role="radio"` buttons and labels around custom selects; native radio inputs styled through their labels and a div field wrapper satisfy it, and tests click the visible label.

## Improvements

- None outstanding from this task.
