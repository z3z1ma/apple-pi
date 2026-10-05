Status: complete
Created: 2026-10-04
Updated: 2026-10-04

# Retrospective

## What Mattered

The work landed in three usable slices: program/host-call inspection (`9de7433`), live worker tools (`0165591`), and shared passive activity (`f37f281`). Both operator-confirmed test boundaries were exercised: registered execution through the shared panel, and fullscreen Pi driven through tmux with controlled work. The companion [task record](task.md) defines program, host call, model worker, and passive activity. Independent reviews found concrete defects that were corrected through regression tests.

The final commit and closure were explicitly requested despite an unresolved validation limitation. The latest full suite passed 1,543/1,544 tests; the task cancellation test expected `Command aborted` but received `This operation was aborted`. Its isolated rerun passed. This is not proof of the cause or of a pre-existing failure. Formatting, lint, typecheck, package checks, and focused checks passed.

## Learnings

- Pi gives each extension a distinct API object and event facade. Shared runtime state needs discovery over the shared event bus, not API-object identity alone. The mixed-domain integration test now exercises the real loader and guards this distinction.
- A parallel worker batch emits each tool's execution-end event before its tool-result messages. Publish live terminal outcomes at execution end; waiting for tool-result messages can conceal a completed failure behind a slow sibling. The controlled fixture and regression cover that ordering.
- Passive rows need single-line display text. General text sanitization preserves intentional newlines for source/detail views, so normalize passive names and objectives locally. The row regression guards physical-line bounds.
- Parse Git patches by complete line-start hunk headers. Splitting on an unanchored `@@ ` also matches trailing header context and can produce an invalid partial patch. Scoped documentation staging used complete hunks and preserved unrelated work.
- A rendered worker tool is not evidence that its controlled HTTP request has reached the test server (the gate holds that request open until the test releases it). Await external fixture readiness before releasing or aborting it; this avoids the races exposed by full-suite concurrency.
- Loader harnesses using a temporary current working directory need absolute repository extension paths. Controlled HTTP responses need a textual Content-Type for JSON-compatible fetch results. Register cleanup before imports and handle pending execution rejections so intended-red failures do not leak state.
- A legal 10 MiB result can wrap into enough lines to exceed JavaScript's argument limit. Append wrapped rows incrementally rather than spreading the entire array into `push`, and test the supported result-size boundary.
- RPC can report `hasUI` while ignoring widget factories. Publish factory-based passive activity only in TUI mode; the RPC integration regression guards this distinction.
- Program timeout/abort and worker host-call outcomes are different observations. A cancelled worker host call can report `failed` with `Agent aborted`, while the program header reports its own timeout and the child tool reports `aborted`. Assert those specific fields rather than searching the whole panel for words such as `running`, which also occur in zero-count summaries.
- For tmux proof, separate Escape/focus changes from subsequent text and verify captured command outcomes. Legacy Enter inserted a newline in the tested keyboard mode; CSI-u Enter (`\x1b[13u`) submitted correctly. Use the negotiated protocol instead of assuming carriage return submits.

## Improvements

The shared active-work owner, immediate child-tool outcome updates, local passive text normalization, long-result rendering, failure-output retention, and logical scroll anchors now have production fixes and behavioral regression coverage. The feature adds no new worker manager or durable inspection history.

Keep the cancellation-message discrepancy as a separate investigation if it recurs; the [task record](task.md#outcome) identifies the test and reproduction commands. The isolated pass does not justify claiming a clean full suite.
