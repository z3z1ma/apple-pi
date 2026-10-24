## symbol:prepareShellCommand

ANSI capture and color emission are separate contracts: the child has piped stdout/stderr, so programs such as Git with `color.ui=auto` can emit no color codes even when capture and rendering preserve them.
Why: the Git comparison on 2026-10-24 produced plain output with pipes and colored output with a pseudo-terminal; explicit Git color settings survived both Bash capture and the tested RTK rewrite. A pseudo-terminal changes pager, prompt, and terminal-control behavior as well as color detection, so it is a behavioral change rather than a renderer fix.
Coupled: components/terse-tools/src/content-formatting.ts, components/rtk/src/index.ts
Verify: components/tasks/tests/tasks.test.ts, components/terse-tools/tests/render-parity.test.ts
