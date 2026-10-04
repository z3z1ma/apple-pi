# 02: Three trap puzzles with reference solutions

**What to build:** Three staged trap puzzles checked into the repository for the benchmark: the slugify diacritics puzzle from the 2026-10-04 demo plus two new kinds of trap. Each puzzle is a tiny repository with a goal text, visible tests, a hidden oracle test that runs in seconds, a known-wrong solution (the obvious fix that passes the visible tests), and a known-right solution. A check proves each puzzle is a real trap.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] For every puzzle, the base fails the oracle, the known-wrong solution passes the visible tests and fails the oracle, and the known-right solution passes both; a test asserts all three.
- [ ] Every puzzle's oracle runs in under 5 seconds and needs no network or package install.
- [ ] The three puzzles trap in different ways (not three variants of one input-coverage gap), and each puzzle's goal names only interfaces an attempt can know.
- [ ] The puzzles stay out of the published package.
