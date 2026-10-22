## file

Interns own one-shot processes; program model calls use ordinary peer sessions. Keep these lifetimes separate. Cancellation uses SIGTERM deliberately: Pi's print/JSON handler kills its tracked detached bash children before disposing the runtime and exiting. Killing only the worker with SIGKILL bypasses that cleanup; a worker process-group kill alone cannot reach tools in their separate groups. The worker is detached from the caller's terminal group so its owner can send the orderly signal. Bound material is removed after process close.

Pi supports `--` before the final positional question. Preserve it so a question beginning with `-` remains text rather than an option.

The shell is part of the intern contract for inspection and source retrieval. A narrower read/grep/find/ls-only constant previously contradicted both the prompt and the documented behavior. File-editing tools stay absent; read-only shell behavior remains an instruction, not a sandbox.

Native event observation is shared with peer turns. Keep process creation and cleanup here and outcome/usage/file-change interpretation in the shared observer.

Coupled: components/interns/src/index.ts, components/interns/src/prompts.ts, components/shared/src/turn-observer.ts
Verify: components/interns/tests/interns.test.ts, tests/home-search-guard-integration.test.ts, tests/ledger-prompt-integration.test.ts, tests/wiki-prompt-integration.test.ts
