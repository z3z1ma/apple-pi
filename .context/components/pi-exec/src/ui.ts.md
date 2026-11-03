## symbol:ExecActivityCall

`children` holds a model worker's child tools and is published only while that worker runs.
Why: child tools are live activity, not a second record of the worker's own call.
Coupled: components/pi-exec/src/active-work.ts
Verify: components/pi-exec/tests/pi-exec.test.ts
