## symbol:outputTextLines

Carry command ANSI state across literal newlines before applying the UI's output color, and finish command styling before appending UI hints or borders.
Why: splitting first and adding a foreground color to each line overwrites styles that the command left active on the previous line; leaving those styles active at the end can style the inspector frame instead. Pi's ANSI-aware wrapper owns the escape-state tracking.
Coupled: components/terse-tools/src/formatters.ts, components/terse-tools/src/tool-viewer.ts
Verify: components/terse-tools/tests/render-parity.test.ts

## symbol:diffLines

Keep Pi's numbered diff and word-level comparison, replacing its SGR inverse-video pair (7/27) with bold (1/22) for changed words.
Why: the operator found reverse-video blocks hard to read and visually similar to selected text. This intentional typography difference applies to completed and pending inline previews and the inspector. Native `renderDiff` has no word-style option; adapting its style codes preserves its comparison without duplicating the diff algorithm or changing the global theme.
Coupled: components/terse-tools/src/formatters.ts, components/terse-tools/src/tool-viewer.ts
Verify: components/terse-tools/tests/render-parity.test.ts

## file

These helpers format presentation copies, rather than changing retained tool results or arguments.
Why: terminal colors belong to the UI; transcripts, tool consumers, and model input must keep the original content.
Coupled: components/tasks/src/output-buffer.ts
Verify: components/tasks/tests/tasks.test.ts, components/terse-tools/tests/render-parity.test.ts
