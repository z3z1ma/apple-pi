## symbol:fauxSession

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

Verify: components/browser-pages/tests/ask-agent.test.ts, components/session-title/tests/session-title.test.ts
