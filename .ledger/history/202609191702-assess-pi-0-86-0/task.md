Status: done
Created: 2026-09-19
Updated: 2026-09-19

# Assess Pi 0.86.0 compatibility

## Intent

Assess Pi 0.86.0 from official changelogs, documentation, source, and tests. Determine the required Apple Pi migration, identify obsolete compatibility code, and prove the proposed state in an isolated upgraded checkout without changing the working repository's package versions.

## Success Criteria

- Summarize Pi 0.86.0's user-facing and breaking changes from primary sources.
- Map each relevant change to Apple Pi production and test code.
- Run the complete Apple Pi validation sequence against Pi 0.86.0 after applying the proposed migration in an isolated copy.
- Record blockers, optional opportunities, and exact follow-up paths in one research artifact.

## Outcome

Completed. The assessment is in `research.md`.

Apple Pi needs test/fixture migrations for transcript provider contexts, JSON tool-call arguments, and the new retry default. Production extensions otherwise compile and validate. The obsolete oversized-tool-result guard and private zero-row-footer mutation should be removed. The proposed migration passed formatting, lint, typecheck, unit, pair, loader, and packaging checks in an isolated Pi 0.86.0 checkout.

The latest `pi-mcp-adapter` does not declare `@earendil-works/pi-ai@0.86.x` peer compatibility, so the package bump should wait for upstream support unless the owner explicitly accepts an override.
