# Pi 0.86.0 implementation and rollout plan

## Decision

Prepare Apple Pi first, prove it against Pi 0.86.0 locally, then update the Bun-installed global Pi binary as the final rollout step.

`pi update self` is the correct command. It updates only the Pi CLI installation. Apple Pi is configured as a user package through its local checkout path, so the command does not update, copy, or reset this repository. Do not use `pi update --all` for this rollout.

There is one gate before merge or host update: the installed `pi-mcp-adapter` must either declare Pi AI 0.86 support, or the operator must explicitly accept an unsupported peer override. As of planning, `pi-mcp-adapter@2.34.0` is latest and accepts only `@earendil-works/pi-ai ^0.84.1 || ^0.85.0`. Its implementation passed the isolated 0.86 checks, but `npm ls` correctly reports the dependency tree as invalid.

Preferred path: wait for an adapter release with a 0.86 peer range. Exception path: keep 2.34.0 only with explicit operator approval, record the exception, run the MCP E2E and live MCP smoke checks, and accept that `npm ls` cannot be a clean acceptance check.

## Scope

### Required

1. Pin the four Pi development packages to exact `0.86.0` and update the lockfile.
2. Migrate faux/custom provider tests to `TranscriptContext` helpers.
3. Tighten the test tool-call fixture to `JsonObject`.
4. Update the pair retry-settings expectation for `maxAgentDelayMs`.
5. Remove the Pi 0.84.4 oversized-tool-result cut-point workaround now owned by Pi 0.86.
6. Remove the private TUI footer `minSize` mutation now owned by Pi 0.86.
7. Update the minimum host version and all product, maintainer, and runtime-prompt wording affected by those removals.
8. Validate the repository and package surface against Pi 0.86.0.
9. Update the global Pi binary only after the repository is green and committed.

### Explicitly retained

- Keep `extensions/compaction-safety.ts`. Its fail-closed behavior on failed or cancelled automatic compaction is separate from the removed cut-point fallback.
- Keep `extensions/auto-compact.ts` and `AUTO_COMPACT_EXTENSION_PATH`; the entrypoint becomes the thin installer for compaction failure safety.
- Keep the xAI server-side compaction hook and notebook compaction packet unchanged.
- Keep the pair `user_bash` observer returning implicit `undefined`.
- Keep `peerDependencies` for Pi packages at `"*"`; exact versions remain development/test pins.
- Keep `embedWorkingStatus: true` in the custom editor.

### Deferred

- Migrating additive `before_agent_start` handlers to `systemPromptOptions.sections`.
- Adding a `cache_warming_decision` handler or changing the default `cacheWarming: "streaming"` policy.
- Adding repository-owned per-model compaction settings.
- Any unrelated `npm audit fix`, dependency refresh, provider change, or UI redesign.

## Change set

### 1. Dependency and host contract

Files:

- `package.json`
- `package-lock.json`
- `README.md`
- `docs/mcp.md` and `THIRD_PARTY_NOTICES.md` only if the MCP adapter version changes

Changes:

- Change these exact dev pins from `0.85.1` to `0.86.0`:
  - `@earendil-works/pi-agent-core`
  - `@earendil-works/pi-ai`
  - `@earendil-works/pi-coding-agent`
  - `@earendil-works/pi-tui`
- Regenerate `package-lock.json` with npm; inspect the diff for unrelated top-level changes.
- Change README's minimum Pi host from `>= 0.85.1` to `>= 0.86.0`.
- At execution time, re-run:

  ```bash
  npm view @earendil-works/pi-coding-agent version --json
  npm view pi-mcp-adapter version peerDependencies --json
  ```

  Stop if the latest Pi version is no longer exactly 0.86.0; reassess the newer release instead of letting `pi update self` jump past the audited version.
- If an MCP adapter release adds 0.86 support, pin it exactly and update `docs/mcp.md` and its third-party notice. Otherwise stop at the decision gate unless the operator approves the exception path.

### 2. Provider and JSON type migration

Files:

- `components/session-search/tests/fixtures.ts`
- `components/subagents/tests/subagent-clarify.test.ts`
- `components/subagents/tests/subagent-runner-e2e.test.ts`
- `components/xai-hosted-tools/tests/summarization.test.ts`
- `tests/auto-compact-integration.test.ts`
- `components/pair-programmer/tests/pair.test.mjs`

Changes:

- Change `assistantWithToolCall(..., args)` from `Record<string, unknown>` to `JsonObject`.
- In faux provider callbacks, replace `context.systemPrompt` with `getCurrentSystemPrompt(context.messages)`.
- Replace `context.tools` with `getCurrentTools(context.messages)`.
- Type the xAI summarization callback as `TranscriptContext`.
- Classify no-tool summary requests with `getCurrentTools(context.messages).length === 0`.
- In the pair-scope E2E, capture the system prompt received by the faux provider. Stop asserting a per-run forced prompt through `result.session.systemPrompt`, which is now the base session prompt.
- Extend the pair retry-settings expectation with `maxAgentDelayMs: 60_000`.

These helpers are unavailable in Apple Pi's current 0.85.1 dev dependencies, so the source migration and four-package bump must land together.

### 3. Remove the oversized-result fallback

Delete:

- `components/notebook/src/hooks/overflow-guard.ts`
- `components/notebook/tests/overflow-guard.test.ts`

Edit:

- `extensions/auto-compact.ts`
  - Remove `registerOverflowGuard` and `Runtime` imports.
  - Install only `installCompactionSafety(pi)`.
- `tests/auto-compact-integration.test.ts`
  - Preserve success, failure, cancellation, and concurrent-session tests.
  - Rename the oversized-result case to describe native compaction.
  - Load the packaged auto-compact entrypoint without calling it a fallback.
  - Assert that compaction completes and no `apple-pi.compaction-cut-point` message is persisted.
- `tests/context-hooks.test.ts`
  - Make the context-hook allowlist empty and update its rationale.
- `tests/package-load.mjs`
  - Require the `session_compact_failed` handler from `auto-compact.ts`.
  - Remove the obsolete `turn_end` fallback-handler requirement.

Update terminology from “automatic-compaction safety/fallback” to “automatic-compaction failure safety” in:

- `README.md`
- `docs/context.md`
- `docs/exec.md`
- `docs/subagents.md`
- `AGENTS.md`
- `extensions/runtime-api.ts`
- `components/subagents/src/agent-runner.ts`
- `THIRD_PARTY_NOTICES.md`

Specific documentation corrections:

- State that Pi 0.86 owns valid cut-point selection for oversized trailing tool results.
- State that Apple Pi only aborts failed/cancelled automatic compaction before provider continuation.
- Remove claims that `PI_PAIR_NOTEBOOK_PASSIVE` controls an overflow fallback; it continues to control notebook/pair automatic maintenance.
- Keep the `pi-auto-compact` provenance notice, but point its retained local behavior at `extensions/compaction-safety.ts` / `extensions/auto-compact.ts` and describe only the retained fail-closed goal.

### 4. Remove the private footer mutation

Files:

- `components/input-editor/src/ui/input-editor.ts`
- `components/input-editor/src/index.ts`
- `components/input-editor/tests/input-editor.test.ts`

Changes:

- Delete `collapseDockFooter()`.
- Remove its constructor, render, and factory calls.
- Remove its public export and dedicated private-layout test.
- Keep the constructor's `tuiForCard` argument because it is still passed to `PiCustomEditor`, but stop storing it as a private field if nothing else reads it.
- Keep the public zero-row `EmptyFooter` and `{ paddingX: 0, embedWorkingStatus: true }` editor options.
- Confirm there is no remaining `layoutRoot` access in the input-editor component.

## Implementation order

1. Recheck Git state and preserve the already-created 0.86 assessment artifacts.
2. Recheck the exact latest Pi and MCP adapter metadata.
3. Resolve the MCP gate.
4. Create one coherent repository change containing dependency pins, test migrations, workaround removals, and documentation updates. Avoid a temporary commit where 0.86-only tests sit on 0.85 dependencies or where the documented minimum host disagrees with production behavior.
5. Run focused checks, then the full proof sequence.
6. Review the complete diff and package dry-run contents.
7. Run `graphify update .` because production code changed.
8. Commit the repository change with a semantic commit such as:

   ```text
   feat: adopt Pi 0.86.0
   ```

9. Stop or settle all other Pi sessions and managed work. Updating the global binary while an old Pi process is still spawning children creates a mixed 0.85/0.86 runtime window.
10. From a plain shell in the clean checkout, record:

    ```bash
    pi --version
    command -v pi
    pi list
    ```

11. Run:

    ```bash
    pi update self
    ```

12. Exit the current 0.85 Pi process. Perform all post-update checks from a fresh shell/process.

## Validation

### Focused checks

```bash
npx vitest run \
  components/session-search/tests \
  components/subagents/tests/subagent-clarify.test.ts \
  components/subagents/tests/subagent-runner-e2e.test.ts \
  components/xai-hosted-tools/tests/summarization.test.ts \
  components/input-editor/tests/input-editor.test.ts \
  tests/auto-compact-integration.test.ts \
  tests/context-hooks.test.ts
npm run test:pair
npm run test:loader
```

The compaction integration tests require a real Git worktree for RTK/runtime cases in the full suite. Do not validate from an rsync copy without initializing Git.

### Full repository proof

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run pack:check
```

Dependency proof on the preferred path:

```bash
npm ls @earendil-works/pi-agent-core \
  @earendil-works/pi-ai \
  @earendil-works/pi-coding-agent \
  @earendil-works/pi-tui \
  pi-mcp-adapter \
  typebox --all
```

Expected results:

- All four Pi packages resolve to 0.86.0.
- No invalid peer dependencies.
- No production `context` hook remains.
- No `collapseDockFooter`, private `layoutRoot` mutation, hidden cut-point type, or legacy faux-provider `context.tools` / `context.systemPrompt` access remains.
- The MCP through `pi_exec` E2E remains in the passing unit suite.

### Post-update host proof

From a fresh shell:

```bash
pi --version
pi list
```

Expected:

- `pi --version` prints `0.86.0`.
- Apple Pi still resolves to `/Users/alexanderbut/code_projects/personal/apple-pi`.

Then start one fresh interactive Pi session in the checkout and verify:

1. Startup reports no extension compilation or registration errors.
2. The Apple Pi input card has no blank footer row.
3. Working status renders inside the editor border during a tool call.
4. `/pair status` works.
5. A minimal `pi_exec` call works.
6. A short read-only subagent call works.
7. `mcp` status loads; on the exception path, make one real configured MCP tool call.
8. End the session and start another to prove clean reload from the new host.

## Rollback

Before self-update, record the upgrade commit and the current `pi --version` (`0.85.1`). If the new host cannot load Apple Pi:

1. From a plain terminal, restore the global Bun package:

   ```bash
   bun add -g @earendil-works/pi-coding-agent@0.85.1
   ```

2. Revert the Apple Pi upgrade commit and restore its dependencies:

   ```bash
   git revert <pi-0.86-upgrade-commit>
   npm ci
   ```

3. Confirm `pi --version`, `npm run typecheck`, and `npm run test:loader` before opening a new session.

Do not keep a split state as the steady state. The upgraded checkout declares Pi >=0.86.0, while the reverted checkout restores the 0.85.1 cut-point and footer compatibility workarounds.

## Acceptance criteria

The undertaking is complete only when:

- The exact package and host versions are 0.86.0.
- The MCP peer gate is resolved or its exception is explicitly approved and recorded.
- The obsolete overflow and footer workarounds are absent.
- Transcript-context and JSON type migrations compile without casts that weaken the new contract.
- Focused and full repository checks pass.
- Package contents are inspected and complete.
- The global self-update succeeds from 0.85.1 to 0.86.0.
- A fresh 0.86.0 process loads Apple Pi and passes the runtime smoke checks.
- Rollback instructions and the upgrade commit are recorded in the task outcome.
