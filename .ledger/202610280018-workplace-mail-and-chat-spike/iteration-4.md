# Fourth iteration: a clean conversation and stable composer

## Operator correction

The operator supplied screenshots of the preview and Slack. Tools off must show only assistant and user written text, rather than the earlier design that retained historical failure warnings. The DM header must stay short instead of changing into a tool command. Current tool detail can appear in the lower activity line if it truncates well. Repair the composer's split outline and add a little polish without importing Slack's clutter. The supplied screenshots were used locally; their private contents were not copied into the repository.

## Changes

- Text-only rendering includes only nonblank user text and assistant text parts. It omits thoughts, extension/task notifications, mail entries, tool calls/results including orphan failures, historical reply errors/stops, and image-only metadata. Tool-only histories leave no empty author rows or tool-placeholder messages. The full history and result index remain loaded, and turning tools on restores details. Original World defaults to showing them.
- Current read/send/link errors remain operational feedback, separate from historical transcript detail. Streaming, pagination, result association, receipts, and hidden-reader cleanup retain their existing paths.
- The workplace header uses a short run-state label plus role: Thinking, Working, Writing a reply, and so on. Shared detailed activity elsewhere is unchanged. Current tool information appears only below the transcript while the actual run state is running_tool. It ellipsizes to the available width on one line and exposes its full value on hover; retained tools cannot override writing or idle.
- The input box and action bar now share continuous edges and focus color. World's inherited footer grid gap caused the border break; its inherited margins also inset the workplace composer twice. Reset those in the workplace only. The zero-minimum grid track contains the action row, the keyboard hint can shrink/ellipsize, and button labels stay on one line.
- A slightly denser header, clearer plum sidebar/selection, aligned composer gutters, truncated long names, and less explanatory chrome. Removed the workspace's decorative dropdown cue rather than adding a fake menu. No editor toolbar, extra backend, or unrelated feature was introduced.

## Verification

- Final build passed. Combined Node/web typecheck passed.
- Four focused browser/build files passed 39 tests with one worker: conversation (23 tests), original interface/workplace, and built-asset consistency. New assertions cover text-only omission/restoration, streamed replies, tool-only history, compact headers, ellipsized activity, no horizontal overflow, and continuous matching border edges at 1280px and 820px widths.
- Extended fixture smoke passed over the final build, including thought-only/error/notification fixtures and long live tool arguments. Existing channel Markdown, membership, mail, and instruction flows still pass. Screenshots: `/tmp/wp-text-only-layout-shots`.
- Real isolated Electron entry/return check passed. Focused Biome and context lint (202 files) passed. Diff checks passed.
- Logs: `/tmp/wp-text-only-verified-tests.log`, `/tmp/wp-text-only-final-types.log`, `/tmp/wp-text-only-layout-{build,test,smoke}.log`, `/tmp/wp-text-only-electron.log`.

An expanded fixture initially made a generic bash-button locator ambiguous with an orphan result; the check now targets the call's public command label. A narrow screenshot then exposed action labels wrapping. Keeping them on one line revealed an actual automatic-grid minimum overflow, which the layout regression caught and the zero-minimum track fixed. Immediate screenshots after viewport resize also showed stale duplicated pixels despite correct DOM/layout; waiting for the repaint boundary fixed that separate capture artifact. Final screenshots show a single stable view and readable controls at both widths.

The preview was rebuilt and the existing application brought forward while supporting checks ran. Use World -> Workplace spike to load the fresh web assets without restarting the daemon. No live messages were sent as validation; no full suite, runtime restart, or commit in this iteration. The UI remains available for operator evaluation.
