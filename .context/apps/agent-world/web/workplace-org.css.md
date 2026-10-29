## file

The overview header's action row aligns to the search input's bottom, not the combined label-and-input center. Profile reporting controls use an Org-qualified button selector to outrank Workplace's late bare-button reset, preserving their border/background at rest without changing the shared button baseline.
Why: centered action buttons appeared above their adjacent input, and equal-specificity style order made Add person look like floating text.

The setup panel has two different reading priorities: editable fields before an initial start, and progress/recovery before immutable fields afterward. Org owns that DOM ordering and the native Setup plan disclosure; this stylesheet supplies spacing inside the disclosed field wrapper and separates position identity from its status. Keep readable status text alongside any state color.
Why: the previous partial-start view left recovery below a long disabled form, and adjacent inline role/status text made repeated positions hard to distinguish. Styling alone cannot correct the ordering, and color alone cannot identify a failed position.
Coupled: apps/agent-world/web/workplace-org.tsx, apps/agent-world/web/workplace.css
Verify: apps/agent-world/tests/world-org.test.ts

The new-position specialization textarea opts out of the general planning textarea minimum height and uses its two-row size. Keep this exception within the draft's specialization field.
Why: the optional focus note should stay compact without shrinking the team task and position goal inputs that still use the shared minimum.
