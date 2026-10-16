# Vitest audit scope

`npx vitest list --json`: 1539 tests in 146 files.

Configuration: `vitest.config.ts` explicitly includes `components/<owner>/tests/**/*.test.ts`, `optional-extensions/{todos,backlog}/tests/**/*.test.ts`, and `tests/**/*.test.ts`. Python sidebar tests, `pair.test.mjs`, loader smoke tests and `vitest.eval.config.ts` are outside this inventory.

Assignment means scoped for investigation, not every test body independently verified.

## UI and tasks (26 files)

- `components/ask-user-question/tests/ask-user-question.test.ts`
- `components/browser-pages/tests/ask-agent.test.ts`
- `components/browser-pages/tests/code-review.test.ts`
- `components/browser-pages/tests/explain-change.test.ts`
- `components/browser-pages/tests/ledger-review.test.ts`
- `components/browser-pages/tests/markdown-marks.test.ts`
- `components/browser-pages/tests/markdown-render.test.ts`
- `components/browser-pages/tests/markdown-review.test.ts`
- `components/browser-pages/tests/page-build.test.ts`
- `components/browser-pages/tests/page-server.test.ts`
- `components/browser-pages/tests/tickets.test.ts`
- `components/input-editor/tests/input-editor.test.ts`
- `components/input-editor/tests/installer.test.ts`
- `components/notify/tests/notify.test.ts`
- `components/prompt-stash/tests/external-editor.test.ts`
- `components/prompt-stash/tests/installer.test.ts`
- `components/prompt-stash/tests/stash.test.ts`
- `components/session-title/tests/session-title.test.ts`
- `components/tasks/tests/task-manager.test.ts`
- `components/tasks/tests/tasks.test.ts`
- `components/terse-tools/tests/inspector.test.ts`
- `components/terse-tools/tests/terse-tools.test.ts`
- `components/terse-tools/tests/tool-mouse.test.ts`
- `components/terse-tools/tests/tool-viewer.test.ts`
- `components/terse-tools/tests/user-message.test.ts`
- `components/tmux-sessions/tests/tmux-sessions.test.ts`

## Shared, branch search, history eval and optional extensions (31 files)

- `components/branch-search/tests/extension.test.ts`
- `components/branch-search/tests/judge.test.ts`
- `components/branch-search/tests/orchestrator.test.ts`
- `components/branch-search/tests/workspace.test.ts`
- `components/history-eval/tests/clone.test.ts`
- `components/history-eval/tests/launcher.test.ts`
- `components/history-eval/tests/run.test.ts`
- `components/history-eval/tests/session.test.ts`
- `components/history-eval/tests/tasks.test.ts`
- `components/shared/tests/active-work.test.ts`
- `components/shared/tests/file-changes.test.ts`
- `components/shared/tests/forked-continuation.test.ts`
- `components/shared/tests/model-profiles.test.ts`
- `components/shared/tests/profile-request.test.ts`
- `components/shared/tests/real-path.test.ts`
- `components/shared/tests/run-command.test.ts`
- `components/shared/tests/sidecar-usage.test.ts`
- `optional-extensions/backlog/tests/backlog-manager.test.ts`
- `optional-extensions/backlog/tests/extension.test.ts`
- `optional-extensions/backlog/tests/state.test.ts`
- `optional-extensions/todos/tests/auto-clear.test.ts`
- `optional-extensions/todos/tests/config.test.ts`
- `optional-extensions/todos/tests/controller.test.ts`
- `optional-extensions/todos/tests/execution.test.ts`
- `optional-extensions/todos/tests/extension.test.ts`
- `optional-extensions/todos/tests/reminder-cadence.test.ts`
- `optional-extensions/todos/tests/repository.test.ts`
- `optional-extensions/todos/tests/settings-menu.test.ts`
- `optional-extensions/todos/tests/state.test.ts`
- `optional-extensions/todos/tests/todo-manager.test.ts`
- `optional-extensions/todos/tests/todo-widget.test.ts`

## Memory and pair (35 files)

- `components/change-reflection/tests/change-reflection.test.ts`
- `components/notebook/tests/compaction-packet.test.ts`
- `components/notebook/tests/compaction-trigger.test.ts`
- `components/notebook/tests/config.test.ts`
- `components/notebook/tests/learning-cycle.test.ts`
- `components/notebook/tests/notebook-maintenance.test.ts`
- `components/notebook/tests/notebook-source-cap.test.ts`
- `components/notebook/tests/open-learnings.test.ts`
- `components/notebook/tests/project-learnings.test.ts`
- `components/notebook/tests/recall-tool.test.ts`
- `components/notebook/tests/session-ledger-fold.test.ts`
- `components/notebook/tests/session-ledger-progress.test.ts`
- `components/notebook/tests/session-ledger-recall.test.ts`
- `components/notebook/tests/session-ledger-render-summary.test.ts`
- `components/notebook/tests/session-ledger-types.test.ts`
- `components/notebook/tests/source-serialization-budget.test.ts`
- `components/pair-programmer/tests/advisory-ordering.test.ts`
- `components/pair-programmer/tests/escalation.test.ts`
- `components/pair-programmer/tests/pair-shared-notebook.test.ts`
- `components/pair-programmer/tests/receipt-expansion.test.ts`
- `components/pair-programmer/tests/review-scheduler.test.ts`
- `components/server-compaction/tests/compaction.test.ts`
- `components/server-compaction/tests/convert.test.ts`
- `components/server-compaction/tests/providers.test.ts`
- `components/server-compaction/tests/replay.test.ts`
- `components/session-search/tests/content.test.ts`
- `components/session-search/tests/format-recall.test.ts`
- `components/session-search/tests/lineage.test.ts`
- `components/session-search/tests/load-messages.test.ts`
- `components/session-search/tests/recall-expand.test.ts`
- `components/session-search/tests/recall-files.test.ts`
- `components/session-search/tests/recall-scope.test.ts`
- `components/session-search/tests/recall-tool-scope.test.ts`
- `components/session-search/tests/render-entries.test.ts`
- `components/session-search/tests/search-entries.test.ts`

## Root, prompts and boundary tools (30 files)

- `components/code-context/tests/context-file.test.ts`
- `components/code-context/tests/gate.test.ts`
- `components/code-context/tests/lint.test.ts`
- `components/home-search-guard/tests/config.test.ts`
- `components/home-search-guard/tests/home-search-guard.test.ts`
- `components/rtk/tests/rtk.test.ts`
- `components/vroom/tests/vroom.test.ts`
- `components/wiki/tests/extension.test.ts`
- `components/wiki/tests/wiki.test.ts`
- `components/xai-hosted-tools/tests/payload.test.ts`
- `components/xai-hosted-tools/tests/summarization.test.ts`
- `tests/auto-compact-integration.test.ts`
- `tests/code-review-skill.test.ts`
- `tests/context-hooks.test.ts`
- `tests/context-root-only.test.ts`
- `tests/custom-wake-prompt.test.ts`
- `tests/home-search-guard-integration.test.ts`
- `tests/ledger-prompt-integration.test.ts`
- `tests/ledger-status.test.ts`
- `tests/mcp-exec-e2e.test.ts`
- `tests/pi-exec-nested-usage.test.ts`
- `tests/pi-exec-work-panel.test.ts`
- `tests/resolving-merge-conflicts-skill.test.ts`
- `tests/session-search-standalone.test.ts`
- `tests/shared-primitives.test.ts`
- `tests/subagent-team-prompt.test.ts`
- `tests/system-prompt-sections.test.ts`
- `tests/tdd-skill.test.ts`
- `tests/wiki-prompt-integration.test.ts`
- `tests/work-manager.test.ts`

## Agents and execution (22 files)

- `components/pi-exec/tests/evidence.test.ts`
- `components/pi-exec/tests/guidance.test.ts`
- `components/pi-exec/tests/pi-exec.test.ts`
- `components/pi-exec/tests/saved-programs.test.ts`
- `components/pi-exec/tests/session.test.ts`
- `components/subagents/tests/consultation.test.ts`
- `components/subagents/tests/subagent-activity.test.ts`
- `components/subagents/tests/subagent-btw-command.test.ts`
- `components/subagents/tests/subagent-btw-viewer.test.ts`
- `components/subagents/tests/subagent-clarify.test.ts`
- `components/subagents/tests/subagent-conversation-viewer-keybindings.test.ts`
- `components/subagents/tests/subagent-conversation-viewer.test.ts`
- `components/subagents/tests/subagent-notebook-e2e.test.ts`
- `components/subagents/tests/subagent-notebook-snapshot-e2e.test.ts`
- `components/subagents/tests/subagent-outcome-framing.test.ts`
- `components/subagents/tests/subagent-pair-notebook-e2e.test.ts`
- `components/subagents/tests/subagent-panel.test.ts`
- `components/subagents/tests/subagent-reflection-e2e.test.ts`
- `components/subagents/tests/subagent-runner-e2e.test.ts`
- `components/subagents/tests/subagent-session-disposal.test.ts`
- `components/subagents/tests/subagent-widget.test.ts`
- `components/subagents/tests/subagents.test.ts`

## Excluded: pre-existing active work (2 files)

- `tests/ledger-add.test.ts`
- `tests/ledger-history.test.ts`
