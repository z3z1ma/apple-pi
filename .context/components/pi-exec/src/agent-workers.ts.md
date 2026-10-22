## file

The one-shot runner serves both `pi_exec` workers and the native intern tools. Keep one subprocess lifecycle owner when either caller changes.

Cancellation uses SIGTERM deliberately: Pi's print/JSON handler kills its tracked detached bash children before disposing the runtime and exiting. Killing only the worker with SIGKILL bypasses that cleanup; a worker process-group kill alone cannot reach bash tools in their separate groups. The worker itself is detached from the caller's terminal process group so it can receive the orderly cancellation signal from its owner.

Pi supports `--` before the final positional task. Preserve it so a question beginning with `-` remains text rather than a CLI option.

Coupled: components/interns/src/index.ts
Verify: components/interns/tests/interns.test.ts, components/pi-exec/tests/pi-exec.test.ts
