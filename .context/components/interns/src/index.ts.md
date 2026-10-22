## file

Lifecycle cancellation waits for each runner to close its process and release bound material. Keep a cancelled call in the ownership map until its execute-finally removes it, while hiding it from the active-work surface. Clearing ownership immediately would let a second overlapping lifecycle event finish without awaiting the still-closing process. Suppress late activity after either cancellation signal.

Coupled: components/interns/src/runner.ts, components/shared/src/active-work.ts
Verify: components/interns/tests/interns.test.ts
