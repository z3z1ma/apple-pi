## symbol:fauxSession

`replies` is a queue, or a function of the request and its abort signal. Return `"until-aborted"` to hold the request until its signal aborts, or a promise to hold it until the test releases a reply. `options.cwd` runs in that existing directory and `dispose` leaves it in place. The agent directory stays outside a supplied cwd, which may be a repository under test. `options.streamText` also emits start, delta and end events. An aborted request ends as aborted whatever reply was scripted; a run aborted between requests sends its next request already aborted.
Why: a supplied repository must not receive the fixture's agent directory, and a scripted reply must not hide a real abort.

Use the callback form returning a Promise to hold a request, including multi-turn scripts; the array form holds complete assistant messages. Run typecheck alongside these integration tests.
Why: Vitest transpiles without typechecking. A callback mistakenly put in the array was emitted as a malformed message and settled the supposedly busy turn, so timing assertions were testing an invalid fixture.
Verify: components/session-state/tests/workplace.test.ts

The provider context the faux stream receives has only `messages`, so each recorded request has no `tools`. An assertion that a fork's tool list equals the parent's compares `undefined` with `undefined` and proves nothing. To prove a fork blocks a tool, have the fork call it, then assert the `This tool is not available in this fork.` result and the missing side effect.
Why: an ask-agent test passed on such a tool-list comparison until a debug dump showed the recorded request keys were only `messages`.

The `tools` argument selects custom tools too. Include the fixture's names when checking a fork's execution policy. An empty list produces `Tool ... not found`, which is not evidence that the policy blocked an available tool.
Verify: components/branch-search/tests/fork-tools.test.ts

`bindExtensions({})` binds no UI, so `ctx.hasUI` is false and a tool that needs a user (such as `sign_off_code` or `sign_off_document`) returns before its flow starts. Test that flow's parts directly: install `trackLiveSessions()` and call the fork helper from a stand-in tool, and cover the HTTP routes with page-server tests.

The session starts in `print` mode. For an extension that acts only in the TUI, call `session.bindExtensions({ mode: "tui", uiContext: { notify } as never })` again after `fauxSession(...)`; that also captures `ctx.ui.notify` warnings. `session.setSessionName` fires `session_info_changed`, which simulates an operator rename. For resume, create the session with `SessionManager.create(cwd, dir)`, then open its file with `SessionManager.open(file)` in a second `fauxSession` on the same cwd.

Observe extension-command failures through `bindExtensions({ onError })`: `session.prompt('/command')` catches handler errors and resolves normally. When a TUI fixture also performs native reads, provide `setStatus` alongside `notify` in its UI fake and assert the error channel stays empty on success.
Why: expecting a rejected prompt missed a resolver error, while an incomplete notification-only fake introduced unrelated `ctx.ui.setStatus is not a function` errors. Fix the observation/fake rather than filtering failures out of positive controls.
Verify: components/session-state/tests/work.test.ts

An invalid image payload (such as base64 `aGk=`) is stored as the text placeholder `[Image omitted: could not be resized…]`, so an "images only" prompt gains text. Use a real 1x1 PNG to test a prompt without text.

`options.streamText` adds start, text, and end stream events so `message_update` fires; without it a faux reply arrives only as `done`. Inside the stream function, its own `options` parameter shadows `fauxSession`'s, so read session options into locals before it.
Why: the first `streamText` attempt read the stream's `options` and never streamed, so a writing-a-reply run state was unobservable.

Lifecycle traps, each found the hard way:
- `session.dispose()` does not emit `session_shutdown`; emit it first (the session-state `close` helper does), or extension watchers outlive the session.
- `session.reload()` emits `session_start` only after a host bound to the session, so call `bindExtensions({ onError })` before the scenario.
- Compaction needs `session.settingsManager.applyOverrides({ compaction: { keepRecentTokens: 1 } })`, or it reports "Nothing to compact".
- Queued custom steers show in `session.agent.hasQueuedMessages()`, not `pendingMessageCount`, and a custom message reaches the model with role `user`.
- A `vi.waitFor` inside a faux tool's `execute` that times out only becomes a tool error, so assert the tool result has `isError: false`.
- With the session-state bridge, bind `{ mode: "tui", uiContext }` before the first prompt (`ask_user_question` drops itself at `before_agent_start` without a UI). After `bindExtensions` rebinds, wait for a database fact the rebind changes (`select role from sessions where id = ?`), not for a `gap` event, which the runtime records only when the old connection already closed.
- A test that holds replies hangs after a delivered `follow_up` releases another held request; end it with `session.abort()`.
- `expect(array).toContain(expect.stringContaining(..))` never matches; use `toContainEqual`.

Extension fakes and model access:
- A fake `ExtensionToolContext` needs `tools` and `executeTool`, and `ctx.executeTool()` also needs an assistant message that issued the parent call, so drive nested calls through a real faux-model turn.
- `pi.setModel` accepts any Model object. `ctx.modelRegistry.find` is the private `session.extensionRunner.modelRegistry.find`, reachable with an `as unknown as { modelRegistry: ... }` cast to spy on which provider and id exist.

Verify: components/browser-pages/tests/ask-agent.test.ts, components/session-title/tests/session-title.test.ts
