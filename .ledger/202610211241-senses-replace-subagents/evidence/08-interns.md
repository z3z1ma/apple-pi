# Ticket 08 evidence

## Behavior

The five `components/interns/tests/interns.test.ts` checks cover the registered guidance and drive the real tool surface through a faux-model AgentSession and a fake worker process:

- The answer is the final prose, with live current-tool/argument updates; bound material is removed and the process has exited before the result returns.
- The `quick` model and thinking setting reach the CLI, with reading built-ins but neither `edit` nor `write`.
- Two calls in one assistant message rendezvous inside their workers, proving they overlap rather than run sequentially.
- Aborting clears the active-work line and terminates both the worker and its detached tool child. The fake models Pi's SIGTERM cleanup; the actual installed print-mode handler was also inspected.
- Failed and truncated reports are errors. Descriptions and guidelines state the cheap intern's benefits and risks.

The focused checks passed: interns (5), existing worker bindings (54), existing type registry (64), session-state activity (7), TypeScript (Node and web), package loader, and package dry run. The package contains the intern sources and extension. Two old wording assertions were changed from scout/research partner to intern after the shared fixed prompts changed. This is not a full-suite result; the full suite remains the final-task check.

## Startup measurement

One cold Pi process, on this Mac on 2026-10-22, using the actual one-shot runner and its explicit extension list:

| Boundary | Elapsed |
| --- | ---: |
| Call to first model request | 1,899 ms |
| Call to returned result and exited process | 1,918 ms |

The provider was a local HTTP OpenAI-compatible fixture that immediately streamed `Ready`; the returned result was completed with that text. The process used a temporary agent directory, model profile, model configuration, and working directory, with offline catalog access. No real model call or live organization runtime was involved. This isolates launch/extension/request overhead rather than measuring inference latency; filesystem caches were warm. It is one observation, not a latency guarantee or a before/after benchmark.

The temporary Vitest measurement file was removed after execution. Its source and raw output are `/tmp/apc08-latency.test.ts` and `/tmp/apc08-latency.json` for this session; the durable result is the table above.
