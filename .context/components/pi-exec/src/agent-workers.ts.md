## file

The one-shot runner serves the native intern tools. Program model calls use ordinary peer sessions through `peer-calls.ts`; keep the interns' process cleanup separate from those people's lifetime.

Cancellation uses SIGTERM deliberately: Pi's print/JSON handler kills its tracked detached bash children before disposing the runtime and exiting. Killing only the worker with SIGKILL bypasses that cleanup; a worker process-group kill alone cannot reach bash tools in their separate groups. The worker itself is detached from the caller's terminal process group so it can receive the orderly cancellation signal from its owner.

Pi supports `--` before the final positional task. Preserve it so a question beginning with `-` remains text rather than a CLI option.

Native event observation and structured-value validation are shared with peer turns. Keep process creation and SIGTERM cleanup here, and outcome/usage/file-change interpretation in the shared observer.

Coupled: components/interns/src/index.ts, components/shared/src/turn-observer.ts
Verify: components/interns/tests/interns.test.ts
