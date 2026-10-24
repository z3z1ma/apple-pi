## symbol:formatExpandedLines

The optional edit preview comes from Pi's existing call-renderer state, through the transcript patch; the formatter does not read the file to reconstruct it. Successful Write previews use the submitted content, not the tool's success acknowledgment.
Why: Pi already owns the asynchronous pre-execution diff, and the success acknowledgment contains no source to highlight. Recomputing either here would duplicate execution work or display the wrong text.
Coupled: components/terse-tools/src/patch.ts, components/terse-tools/src/content-formatting.ts
Verify: components/terse-tools/tests/render-parity.test.ts
