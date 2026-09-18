# Pi 0.85.x opportunities for Apple Pi

Research date: 2026-09-17

## Executive judgment

Pi 0.85.1 is worth adopting. It is a host-alignment upgrade, not a reason to invent Apple Pi features. The 0.85 line does not replace notebook policy, xAI compaction, hosted-tool injection, pair pacing, ledger/wiki prompts, or the bash/RTK override.

Recommended sequence:

1. Align the four directly pinned Pi development packages on 0.85.1.
2. Keep the input card's standalone working row. 0.85 embeds the spinner in the *default* editor border; custom editors still default to the standalone row unless they pass `{ embedWorkingStatus: true }`.
3. Keep the private footer bridge. 0.85.1 still does not expose subscription or automatic-compaction qualifiers on `ReadonlyFooterDataProvider`.
4. Prove terse-tools against 0.85.1 before calling the upgrade done. `ToolExecutionComponent` gained mouse handling, a renderer-pair constructor, and extra private fields; Apple Pi patches `render`.
5. Take the remaining 0.85.0/0.85.1 changelog items as upstream fixes or operator catalog changes. Do not add Apple Pi code for GPT-6 Astra, vLLM priority, LaTeX, fullscreen jump-to-latest, or persistent Claude effort.
6. During adoption, bump `pi-mcp-adapter` from 2.26.0 to a 0.85-aware release (2.34.0 peers `@earendil-works/pi-ai`: `^0.84.1 || ^0.85.0`). 2.26.0 still loaded under npm's override and passed tests, but the peer is dishonest.
7. Do not install unreleased main. Watch `user_bash` fail-closed, `pi.on()` unsubscribe, `ctx.modelRegistry.stream()`, default constrained sampling, and mid-conversation `before_agent_start` prompt placement.

## Primary sources

- [Pi coding-agent changelog on `main`](https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/CHANGELOG.md) (0.85.0, 0.85.1, Unreleased)
- [Pi coding-agent changelog at `v0.85.1`](https://raw.githubusercontent.com/earendil-works/pi/v0.85.1/packages/coding-agent/CHANGELOG.md)
- [Pi tui changelog on `main`](https://raw.githubusercontent.com/earendil-works/pi/main/packages/tui/CHANGELOG.md)
- [Pi ai changelog at `v0.85.1`](https://raw.githubusercontent.com/earendil-works/pi/v0.85.1/packages/ai/CHANGELOG.md)
- [GitHub release v0.85.0](https://github.com/earendil-works/pi/releases/tag/v0.85.0)
- npm artifact `@earendil-works/pi-coding-agent@0.85.1`, especially `docs/extensions.md` (Custom Editor, `user_bash`) and `dist/modes/interactive/components/custom-editor.d.ts`
- Installed `@earendil-works/pi-*-0.84.4` in this checkout

Apple Pi currently pins these development dependencies to 0.84.4:

- `@earendil-works/pi-agent-core`
- `@earendil-works/pi-ai`
- `@earendil-works/pi-coding-agent`
- `@earendil-works/pi-tui`

README documents Pi `>= 0.84.4` as the minimum host.

## Priority decisions

### P0 — Upgrade the Pi package family together to 0.85.1

Upgrade all four pins in one change, as in the 0.84.4 adoption. Keep Pi's bundled packages as `peerDependencies: "*"`. Document 0.85.1 as the minimum supported host; operators update the installed host with `pi update`.

Breaking changes that do **not** require Apple Pi code:

- **pi-ai 0.85.0**: `createGatewayBindingFetch()` → `createAiBindingFetch()` for Cloudflare Workers AI. Apple Pi does not import those names.
- **pi-tui 0.85.0**: coding-agent env-var defaults removed from pi-tui (`PI_DEBUG_REDRAW` → `PI_TUI_DEBUG_REDRAW`; hardware cursor and clear-on-shrink must be set on the renderer). Apple Pi does not construct the TUI renderer; Interactive Mode still does.

0.85.1 is the latest tagged family. 0.85.0 published experimental `client` / `experimental/plugin` subpaths by mistake; 0.85.1 makes those source-only. Skip 0.85.0 as an install target.

### P0 — Re-prove terse-tools on 0.85.1

`components/terse-tools` patches Pi prototypes: `ToolExecutionComponent.render`, `AssistantMessageComponent.updateContent` / `render`, compaction and branch summary renders, `UserMessageComponent`, `Container.addChild`, and `Theme.fg`.

Compared with 0.84.4, the 0.85.1 `ToolExecutionComponent` public type:

- accepts `ToolRenderers | ToolDefinition<any, any, any>` instead of `ToolDefinition<any, any>`;
- adds `handleMouse`;
- adds private `contentTextRegion`, `selfRenderHeight`, and `createResultRegion`;
- drops `builtInToolDefinition`.

`AssistantMessageComponent` adds private `thinkingVisibilityOverrides`. Compaction, branch-summary, and user-message `.d.ts` files are unchanged.

Apple Pi tests construct `ToolExecutionComponent` with the same 7-argument shape and `undefined` tool definition, so they should still compile. The risk is behavioral: mouse regions and self-render height can make a `render` override miss layout that 0.85 now owns. Do not ship the pin bump until `components/terse-tools` tests and a visual smoke of tool cards, thought hiding, and compaction/branch divider rules pass on 0.85.1.

### P1 — Keep the standalone working indicator

0.85.0 moved the streaming working indicator into the default editor border (`CustomEditorOptions.embedWorkingStatus`). Extension docs:

> Custom editors keep the standalone working row by default. Pass `{ embedWorkingStatus: true }` as the fourth `CustomEditor` constructor argument to use the built-in editor-border spinner instead.

Apple Pi's `InputCardEditor` currently calls `super(..., { paddingX: 0 })` and the product contract says the card does not change working-state semantics. On 0.85.1 that remains correct with no code change.

Do **not** opt into `embedWorkingStatus` as part of the upgrade. The card already draws its own top rule and accent rail; embedding Pi's spinner into `CustomEditor`'s top border would fight that frame. A later visual pass can fold the spinner into the card if the standalone row looks wrong next to the new default.

Unreleased main also moves compaction, branch-summary, and retry spinners into the same editor-border opt-in. That is a future visual risk for the card, not a 0.85.1 blocker.

### P1 — Keep the private footer bridge

`ReadonlyFooterDataProvider` in 0.85.1 is still git branch, extension statuses, provider count, and `onBranchChange`. It still does not expose subscription or `autoCompactionEnabled`. The 0.84.x private `setExtensionFooter` capture in `components/status-footer/src/bridge.ts` remains necessary. Re-run the bridge tests on 0.85.1 because they patch `InteractiveMode.prototype.setExtensionFooter`.

### P1 — Pair `user_bash` stays a watch, not a rewrite

The pair registers `user_bash` only to `watchPrimaryBash` and returns `undefined`. 0.85.1 docs still treat that as “continue with local bash.” Compatible.

Unreleased main makes `user_bash` fail-closed: errors or invalid defined results abort the command; `undefined` still continues. After that lands, keep returning `undefined` and do not throw from `watchPrimaryBash`. No Apple Pi change for 0.85.1.

Apple Pi's replaced `bash` tool already uses `ctx?.cwd || cwd`. The 0.85.0 built-in-tool `ctx.cwd` fix is therefore already matched for the override path.

### YAGNI from 0.85.0 / 0.85.1

Leave these to Pi. They are not Apple Pi features:

- Persistent Claude thinking effort and signed-thinking recovery
- Fullscreen jump-to-latest and Alt-wheel scrolling
- `SessionManager.inMemory()` restorable SDK sessions
- `vllmPriority` / `supportsMaxOutputTokens`
- LaTeX join symbols
- GPT-6 Astra catalog entry
- Provider catalog and stream-parser fixes (Grok Build 0.1, Codex SSE, Copilot Fable 5, Fireworks GLM, `NO_PROXY`, musl fd/rg, session fork compaction boundary, RPC abort during manual compaction)

Session-fork compaction-boundary and in-memory-fork fixes are valuable and come free with the host upgrade.

### Unreleased main — watchlist only

Do not pin `main`. When a later tag ships, re-assess:

| Change | Apple Pi surface | Likely action |
| --- | --- | --- |
| `user_bash` fail-closed | pair `user_bash` | Keep returning `undefined`; add a regression if `watchPrimaryBash` can throw |
| `pi.on()` returns unsubscribe | many extensions | Optional lifecycle cleanup; current `session_shutdown` paths already exist |
| `ctx.modelRegistry.stream()` / `streamSimple()` | pair/consultant model calls | Only if a current DIY stream can be deleted |
| Default strict-prefer JSON-schema sampling for built-in tools | tasks bash re-registration | Check whether the override should set `constrainedSampling` explicitly |
| `before_agent_start` `systemPrompt` / `forceSystemPrompt` as leading system prompt on mid-conversation-system-message models | ledger, wiki, rtk, pair append | Verify append-only prompts still land where prefix cache expects |
| Per-model `reserveTokens` / `keepRecentTokens` | auto-compact cut-point fallback | Recheck the oversized-result gap against the new overrides |
| Compaction/retry spinners share custom-editor embed opt-in | input card | Visual only |
| Extension tools without parameter schemas rejected | all `registerTool` | Already schema-backed; confirm no schema-less tool remains |
| Fullscreen custom footer with zero rows | input card footer | Card always renders rows; low risk |

## Validation (temporary 0.85.1, then restored 0.84.4)

Temporary install of the four packages at 0.85.1 (caret resolved to 0.85.1). npm warned that `pi-mcp-adapter@2.26.0` peers `pi-ai@^0.84.1`; the override was used.

Passed:

- `npm run typecheck`
- Vitest: 95 files, 1051 tests
- `npm run test:pair`: 121/121 offline
- `npm run test:loader`: all extension entrypoints loaded

Pins and lockfile were restored to 0.84.4 afterward. Adoption should pin exact `0.85.1`, not `^0.85.1`.

Not verified: interactive TUI smoke of terse tool cards, the standalone working row next to the input card, and `setExtensionFooter` on a live 0.85.1 host. Pair E2E remains opt-in (`PAIR_E2E=1`).
