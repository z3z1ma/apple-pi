## file

npm run test:pair runs the deterministic offline layers: pure formatting, real PairRuntime with a stub agent, extension loading/lifecycle, and TUI rendering. PAIR_E2E opts into a real Pi RPC model run; it uses the hidden no-review command seam, not the pair model's reconfirmation cycle.
Why: live model timing cannot deterministically prove hold/reconfirm/delivery interleavings, and the normal offline command must remain independent of authentication/network access.

The stub prompt defers its response past the primary hook's return. Boundary delivery and dedup bookkeeping remain distinct from the review callback. Provider failure assistant messages count as failed reviews even if prompt resolves.
Why: synchronous stubs or throw-only failures would miss the actual asynchronous delivery and transactional rollback boundaries.

Keep loader tests under a temporary PI_CODING_AGENT_DIR and restore it on exit. PI_DIST supports wrapper-based Pi installs, and the loader aliases resolve dependencies from installed, hoisted or checkout layouts.
Why: offline tests must not change the operator's enablement/prompt state or depend on the pi executable being a symlink to one installation layout.
Coupled: components/pair-programmer/src/extension.ts, components/pair-programmer/src/formatting.ts, components/pair-programmer/src/session.ts, package.json
Verify: components/pair-programmer/tests/pair.test.mjs
