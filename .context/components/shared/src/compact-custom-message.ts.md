## symbol:rendersInline

`terse-tools` keeps the next tool call adjacent only to a custom message this registry knows; a one-line message that is not registered with `renderInline` still gets a blank line before the following tool.
Why: terse-tools once recognised pair notes by the hard-coded type `"advisory"`, so mail rendered on one line but still left a gap before the next tool.
Coupled: components/terse-tools/src/patch.ts, components/session-state/src/mail.ts, components/pair-programmer/src/extension.ts
Verify: components/terse-tools/tests/terse-tools.test.ts, components/session-state/tests/mail-render.test.ts
