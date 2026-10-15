## symbol:fauxSession

The provider context the faux stream receives has only `messages`, so each recorded request has no `tools`. An assertion that a fork's tool list equals the parent's compares `undefined` with `undefined` and proves nothing (`components/subagents/tests/subagent-clarify.test.ts` still has one). To prove a fork blocks a tool, have the fork call it, then assert the `This tool is not available in this fork.` result and the missing side effect.
Why: an ask-agent test passed on such a tool-list comparison until a debug dump showed the recorded request keys were only `messages`.

`bindExtensions({})` binds no UI, so `ctx.hasUI` is false and a tool that needs a user (such as `review_code` or `review_markdown`) returns before its flow starts. Test that flow's parts directly: install `trackLiveSessions()` and call the fork helper from a stand-in tool, and cover the HTTP routes with page-server tests.

Verify: components/browser-pages/tests/ask-agent.test.ts
