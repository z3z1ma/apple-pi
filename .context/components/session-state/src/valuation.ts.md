## file

`readValuation` reads only the header, the lines before the first `# ` heading, so a goal whose text mentions "Value: $..." never changes the task's worth. `worthLines` output must therefore go above the title heading wherever a `task.md` is written. The reader accepts every amount the writer's number formatting can produce, including exponent form such as `$1e+21`, with no cap.
Why: a review found that amounts outside plain decimal notation were written but read back as unvalued or as a cost of delay of 0, silently dropping accepted input.
Coupled: components/session-state/src/work.ts
Verify: components/session-state/tests/valuation.test.ts, components/session-state/tests/work.test.ts
