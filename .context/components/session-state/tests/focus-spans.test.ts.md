## file

Eve is still focused, so the production triggers would write her span too. The fixture records today's focus without those triggers. A second start replays nothing again.
Why: letting the triggers run would add a span the test is not asserting, and a second start must not duplicate the first replay.
Verify: components/session-state/tests/focus-spans.test.ts
