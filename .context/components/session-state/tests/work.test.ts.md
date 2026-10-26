## file

Native-tool evidence assertions must inspect the returned impact/finding entries as well as readable output, not merely section headings or provenance strings shared by several sections.
Why: the renderer always emits headings, and an impact already prints both recorder and task. Those text matches can pass even if the finding projection is empty. Checking grouped finding entries and an unchanged total proves the requested evidence is delivered without charging estimates or findings.
Coupled: components/session-state/src/work-tools.ts, components/session-state/src/fitness.ts
Verify: components/session-state/tests/work.test.ts
