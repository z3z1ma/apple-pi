## file

Measure the effective first-turn prompt and declarations from the transcript through Pi's getCurrentSystemPrompt and getCurrentTools. The session.systemPrompt getter after prompt() settles uses base options again, so it omits sections added at before_agent_start and understates the budget. getToolDefinition returns the registered base definition, before native codemode's prepareLoadout adds script-call descriptions and its nested-tool catalog. Faux provider contexts keep effective declarations in system messages rather than a top-level tools field; measuring those declarations includes the native transformations.

The session is named "Budget Fixture" before the extensions bind, so session-title draws no random human name.
Why: the drawn name enters `<org>`, and its varying length moved the root measurement by a few tokens from run to run, failing an exact ceiling.

The root fixture waits for its hello to appear in the scratch database before the measured turn. An unroled root gains manager tools only once it is recorded; racing that write measured an ordinary worker's smaller loadout.

The package's extensions and skills come from the manifest, while user settings, AGENTS files, personal roles/Self, MCP and saved programs stay outside this portable fixture. Root callers opt into `nativeTools` to install Pi's real codemode and tool-search factories; SDK sessions omit these CLI-built-in extensions by default. Discovery is enabled through the fixture's `defaultTools` setting, while the package's programs extension activates codemode and role posture can remove it. Intern callers leave the factories out, as their production runner does. BTW uses its own production loader, even when the parent has native tools.
Why: the former root fixture silently omitted both native tools, so active-versus-taught checks passed and prompt/schema budgets understated the root surface. Assert expected native tools as well as the absence of toolbox gaps.

The root ceiling was corrected from 34,384 to the measured 36,877 on 2026-11-07, authorized by Mengxue in task work-7b4d9055 message 14182. The previous fixture measured 34,382 while omitting native tools. Adding their registered definitions measured 35,104; measuring their effective declarations measured 36,877 (33,166 prompt characters plus 114,339 declaration characters). This corrects a coverage error, rather than allowing product growth; subsequent reductions still ratchet down from the corrected baseline. Product wording is unchanged. The metric remains characters divided by four for prompt text and tool names, descriptions and parameter schemas, rather than provider tokenization or complete wire-payload size.

Pair reviews and notifications are disabled without removing their extension registrations. Shutdown precedes disposal so a surviving bridge cannot restart a daemon after scratch cleanup.

Coupled: tests/prompt-budgets.test.ts, tests/helpers/build-budgets.ts
Verify: tests/prompt-budgets.test.ts
