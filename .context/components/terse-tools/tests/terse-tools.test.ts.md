## file

Spacing tests render real Pi message and tool components through a Container. Cover intermediate tool-only turns and turns with hidden thinking, and assert the resulting transcript rows and expansion hint.
Why: classifying a sibling as transparent is an implementation choice, not the user contract. Either intermediate shape must leave adjacent tool rows with the hint on the final row; visible assistant text and thought cards retain their own separation.
Coupled: components/terse-tools/src/patch.ts, docs/terse-tools.md
Verify: components/terse-tools/tests/terse-tools.test.ts
