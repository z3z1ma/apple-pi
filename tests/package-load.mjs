import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createEventBus } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/event-bus.js";
import {
	createExtensionRuntime,
	loadExtensions,
} from "../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js";
import {
	expandPromptTemplate,
	loadPromptTemplates,
} from "../node_modules/@earendil-works/pi-coding-agent/dist/core/prompt-templates.js";
import { loadSkills } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/skills.js";

const temp = mkdtempSync(join(tmpdir(), "apple-pi-load-"));
process.env.PI_CODING_AGENT_DIR = temp;
try {
	const eventBus = createEventBus();
	const result = await loadExtensions(
		[
			"extensions/pi-pair.ts",
			"extensions/ask-user-question.ts",
			"extensions/context.ts",
			"extensions/remind-me.ts",
			"extensions/auto-compact.ts",
			"extensions/vroom.ts",
			"extensions/home-search-guard.ts",
			"extensions/runtime.ts",
			"extensions/mcp.ts",
			"extensions/subagents.ts",
			"extensions/ledger.ts",
			"extensions/wiki.ts",
			"extensions/xai-hosted-tools.ts",
			"extensions/xai-context-compaction.ts",
			"extensions/notify.ts",
			"extensions/tmux-sessions.ts",
			"extensions/status-footer.ts",
		],
		process.cwd(),
		eventBus,
		createExtensionRuntime(),
	);
	assert.deepEqual(result.errors, []);
	assert.equal(result.extensions.length, 17);
	const optionalResult = await loadExtensions(
		["optional-extensions/backlog/index.ts", "optional-extensions/todos/index.ts"],
		process.cwd(),
		createEventBus(),
		createExtensionRuntime(),
	);
	assert.deepEqual(optionalResult.errors, []);
	assert.equal(optionalResult.extensions.length, 2);
	assert(
		optionalResult.extensions.some((extension) => extension.tools.has("backlog_add")),
		"optional backlog is not loadable",
	);
	assert(
		optionalResult.extensions.some((extension) => extension.tools.has("todo_create")),
		"optional todos are not loadable",
	);
	assert(
		result.extensions.some(
			(extension) =>
				extension.path.endsWith("tmux-sessions.ts") &&
				(extension.handlers.get("agent_settled")?.length ?? 0) > 0 &&
				(extension.handlers.get("session_shutdown")?.length ?? 0) > 0,
		),
		"missing tmux-sessions status-publishing hooks",
	);
	assert(
		result.extensions.some((extension) => extension.path.endsWith("status-footer.ts")),
		"missing input card extension",
	);
	assert(
		result.extensions.some(
			(extension) =>
				extension.path.endsWith("auto-compact.ts") &&
				(extension.handlers.get("turn_end")?.length ?? 0) > 0 &&
				(extension.handlers.get("session_compact_failed")?.length ?? 0) > 0,
		),
		"missing automatic-compaction safety/fallback",
	);
	assert(
		result.extensions.some(
			(extension) =>
				extension.path.endsWith("home-search-guard.ts") && (extension.handlers.get("tool_call")?.length ?? 0) > 0,
		),
		"missing home search guard",
	);
	assert(
		result.extensions.some(
			(extension) =>
				extension.path.endsWith("vroom.ts") && (extension.handlers.get("before_provider_request")?.length ?? 0) > 0,
		),
		"missing vroom (fast mode) provider hook",
	);
	assert(
		result.extensions.some(
			(extension) =>
				extension.path.includes("xai-hosted-tools") &&
				(extension.handlers.get("before_provider_request")?.length ?? 0) > 0,
		),
		"missing xAI hosted tools before_provider_request hook",
	);
	assert(
		result.extensions.some(
			(extension) =>
				extension.path.includes("xai-context-compaction") &&
				(extension.handlers.get("session_before_compact")?.length ?? 0) > 0 &&
				(extension.handlers.get("before_provider_request")?.length ?? 0) > 0,
		),
		"missing xAI context compaction hooks",
	);
	assert(
		result.extensions.some(
			(extension) =>
				extension.path.endsWith("ledger.ts") && (extension.handlers.get("before_agent_start")?.length ?? 0) > 0,
		),
		"missing ledger system-prompt injection",
	);
	assert(
		result.extensions.some(
			(extension) =>
				extension.path.endsWith("wiki.ts") && (extension.handlers.get("before_agent_start")?.length ?? 0) > 0,
		),
		"missing wiki workbench system-prompt injection",
	);
	assert(
		!result.extensions.some((extension) => extension.path.endsWith("workflow.ts")),
		"default package must not load a workflow extension",
	);
	assert(
		result.extensions.some(
			(extension) =>
				extension.path.endsWith("subagents.ts") && (extension.handlers.get("before_agent_start")?.length ?? 0) > 0,
		),
		"missing live subagent-team system-prompt injection",
	);

	const commands = new Set(result.extensions.flatMap((extension) => [...extension.commands.keys()]));
	const tools = new Set(result.extensions.flatMap((extension) => [...extension.tools.keys()]));
	for (const command of [
		"pair",
		"mcp",
		"mcp-auth",
		"agents",
		"btw",
		"fast",
		"notify-setup",
		"notify-test",
		"pi-sessions",
	]) {
		assert(commands.has(command), `missing /${command}`);
	}
	for (const tool of [
		"acknowledge_pair_findings",
		"ask_user_question",
		"remind_me",
		"search_session",
		"revisit_note",
		"pi_exec",
		"pi_discover_programs",
		"pi_exec_program",
		"mcp",
		"agent",
		"get_subagent_result",
		"steer_subagent",
		"ledger_add",
		"ledger_close",
		"wiki_lint",
		"wiki_references",
	]) {
		assert(tools.has(tool), `missing ${tool} tool`);
	}
	for (const name of [
		"backlog_add",
		"backlog_list",
		"backlog_take",
		"todo_create",
		"todo_list",
		"todo_get",
		"todo_update",
		"todo_delete",
		"todo_execute",
		"todo_output",
		"todo_stop",
	]) {
		assert(!tools.has(name), `default package must not expose ${name}`);
	}
	for (const name of ["backlog", "todos"]) assert(!commands.has(name), `default package must not expose /${name}`);
	const reminderTool = result.extensions
		.flatMap((extension) => [...extension.tools.values()])
		.find((tool) => tool.definition.name === "remind_me");
	assert(reminderTool, "missing remind_me tool");
	assert.deepEqual(Object.keys(reminderTool.definition.parameters.properties), ["message"]);
	assert(
		result.extensions.some((extension) => extension.path.endsWith("remind-me.ts")),
		"missing self-reminder extension",
	);

	const piExecTool = result.extensions
		.flatMap((extension) => [...extension.tools.values()])
		.find((tool) => tool.definition.name === "pi_exec");
	const limits = piExecTool.definition.parameters.properties.limits?.properties;
	assert(limits, "pi_exec limits parameter missing");
	assert.equal(limits.agentBudget.maximum, 128);
	assert.equal(limits.callBudget.maximum, 2048);
	assert.equal(limits.concurrency.maximum, 32);
	assert.equal(limits.timeoutSeconds.maximum, 7200);
	const manifest = JSON.parse(readFileSync("package.json", "utf8"));
	assert.deepEqual(manifest.pi.skills, ["./skills"]);
	assert.deepEqual(manifest.pi.prompts, ["./prompts"]);
	assert(
		!manifest.pi.extensions.includes("./extensions/workflow.ts"),
		"package manifest must not load workflow extension",
	);
	assert(manifest.pi.extensions.includes("./extensions/vroom.ts"), "package manifest omits vroom (fast mode)");
	assert(
		manifest.pi.extensions.includes("./extensions/home-search-guard.ts"),
		"package manifest omits home search guard",
	);
	assert(
		manifest.pi.extensions.includes("./extensions/remind-me.ts"),
		"package manifest omits self-reminder extension",
	);
	assert(manifest.pi.extensions.includes("./extensions/wiki.ts"), "package manifest omits wiki workbench");
	assert(!manifest.pi.extensions.includes("./extensions/todos.ts"), "package manifest must not load todos extension");
	assert(
		!manifest.pi.extensions.includes("./extensions/backlog.ts"),
		"package manifest must not load backlog extension",
	);
	assert(manifest.files.includes("components/vroom/src/"), "package manifest omits vroom (fast mode) source");
	assert(
		manifest.files.includes("components/home-search-guard/src/"),
		"package manifest omits home search guard source",
	);
	assert(manifest.files.includes("components/reminders/src/"), "package manifest omits self-reminder source");
	assert(manifest.files.includes("components/wiki/src/"), "package manifest omits wiki source");
	assert(
		manifest.files.includes("optional-extensions/todos/index.ts"),
		"package manifest omits optional todos entrypoint",
	);
	assert(manifest.files.includes("optional-extensions/todos/src/"), "package manifest omits optional todos source");
	assert(
		manifest.files.includes("optional-extensions/backlog/index.ts"),
		"package manifest omits optional backlog entrypoint",
	);
	assert(manifest.files.includes("optional-extensions/backlog/src/"), "package manifest omits optional backlog source");
	assert(manifest.files.includes("skills/"), "package manifest omits skills");
	assert(manifest.files.includes("prompts/"), "package manifest omits prompt templates");
	assert(manifest.files.includes("docs/"), "package manifest omits documentation");
	const promptTemplates = loadPromptTemplates({
		cwd: process.cwd(),
		agentDir: temp,
		promptPaths: manifest.pi.prompts,
		includeDefaults: false,
	});
	assert.deepEqual(
		promptTemplates.map((template) => template.name),
		["distill", "interrogate"],
	);
	const distillTemplate = promptTemplates.find((template) => template.name === "distill");
	assert(distillTemplate);
	assert.equal(distillTemplate.argumentHint, "[focus]");
	assert.match(distillTemplate.description, /durable knowledge and reusable harness artifacts/);
	assert.match(expandPromptTemplate("/distill", promptTemplates), /the most recent meaningful body of work/);
	assert.match(expandPromptTemplate("/distill debugging workflow", promptTemplates), /focused on: debugging workflow/);
	assert.match(distillTemplate.content, /AGENTS\.md/);
	assert.match(distillTemplate.content, /do not create or modify artifacts/i);
	const interrogateTemplate = promptTemplates.find((template) => template.name === "interrogate");
	assert(interrogateTemplate);
	assert.equal(interrogateTemplate.argumentHint, "[subject]");
	assert.match(interrogateTemplate.description, /plan, decision, or idea/);
	assert.match(expandPromptTemplate("/interrogate", promptTemplates), /current conversation/);
	assert.match(expandPromptTemplate("/interrogate cache invalidation", promptTemplates), /cache invalidation/);
	assert.match(interrogateTemplate.content, /design tree/);
	assert.match(interrogateTemplate.content, /in-scope frontier is empty/);
	assert.match(interrogateTemplate.content, /do not create or modify files/i);
	const explicitWorkflowSkills = [
		"implement",
		"improve-codebase-architecture",
		"interrogate-to-design",
		"to-spec",
		"to-tickets",
		"wayfinder",
	];
	const engineeringSkills = [
		"prototype",
		"diagnosing-bugs",
		"research",
		"tdd",
		"resolving-merge-conflicts",
		"domain-modeling",
		"codebase-design",
	];
	const fundamentalSkills = ["code-review", "ralph", "pi-exec", "skill-authoring", "llm-wiki"];
	const packagedSkills = [...explicitWorkflowSkills, ...engineeringSkills, ...fundamentalSkills];
	const loadedSkills = loadSkills({
		cwd: process.cwd(),
		skillPaths: manifest.pi.skills,
		includeDefaults: false,
		agentDir: temp,
	});
	assert.deepEqual(loadedSkills.diagnostics, []);
	assert.deepEqual(loadedSkills.skills.map((skill) => skill.name).sort(), packagedSkills.toSorted());
	assert(!loadedSkills.skills.some((skill) => skill.name === "review"), "legacy review skill must be absent");
	for (const skill of loadedSkills.skills) {
		assert.equal(skill.filePath.split("/").at(-2), skill.name, `skill directory/name mismatch: ${skill.filePath}`);
		assert.equal(
			skill.disableModelInvocation,
			explicitWorkflowSkills.includes(skill.name),
			`incorrect model-invocation policy: ${skill.name}`,
		);
	}
	for (const skill of packagedSkills) {
		assert(existsSync(`skills/${skill}/SKILL.md`), `missing packaged skill: ${skill}`);
	}
	const askUserTool = result.extensions
		.flatMap((extension) => [...extension.tools.values()])
		.find((tool) => tool.definition.name === "ask_user_question");
	assert(askUserTool, "missing ask_user_question tool definition");
	const agentTool = result.extensions
		.flatMap((extension) => [...extension.tools.values()])
		.find((tool) => tool.definition.name === "agent");
	assert(agentTool, "missing agent tool definition");
	assert.match(agentTool.definition.description, /<subagent-team>/);
	assert.match(
		agentTool.definition.description,
		/lists everyone available, including each teammate's configured inference profile and own description/,
	);
	assert.match(agentTool.definition.description, /<inference-profiles>/);
	assert.match(agentTool.definition.description, /system_prompt only for invocation-specific guidance/);
	const piExecCodeDescription = piExecTool.definition.parameters.properties.code.description;
	assert.doesNotMatch(piExecTool.definition.description, /<subagent-team>/);
	assert.doesNotMatch(piExecTool.definition.description, /<inference-profiles>/);
	assert.match(piExecCodeDescription, /<subagent-team>/);
	assert.match(piExecCodeDescription, /callable teammates with name, inference profile, and description/);
	assert.match(piExecCodeDescription, /<inference-profiles>/);
	assert.match(piExecCodeDescription, /profile selects an inference profile/);
	assert.match(piExecCodeDescription, /systemPrompt appends dynamic specialization/);
	const agentProperties = agentTool.definition.parameters.properties;
	assert("profile" in agentProperties, "Agent schema omits the inference profile selector");
	assert.deepEqual(
		agentProperties.profile.anyOf.map((entry) => entry.const),
		["quick", "balanced", "pair", "deep", "coding", "visual-engineering", "background"],
	);
	assert("system_prompt" in agentProperties, "Agent schema omits invocation-level system guidance");
	assert.match(
		agentProperties.system_prompt.description,
		/appended after the selected definition and preloaded skills/,
	);
	assert.match(agentProperties.system_prompt.description, /cannot change capabilities/);
	assert("output_path" in agentProperties, "Agent schema omits host-written output files");
	assert.match(agentProperties.output_path.description, /final response verbatim/);
	assert.match(agentProperties.output_path.description, /root session's working directory/);
	assert(!agentTool.definition.parameters.required.includes("output_path"), "output_path must remain optional");
	assert(!agentTool.definition.parameters.required.includes("pair"), "pair must remain optional for config defaults");
	const resultTool = result.extensions
		.flatMap((extension) => [...extension.tools.values()])
		.find((tool) => tool.definition.name === "get_subagent_result");
	assert(!resultTool.definition.parameters.required.includes("yield_seconds"));
	assert(!("maximum" in resultTool.definition.parameters.properties.yield_seconds));
	assert.match(resultTool.definition.parameters.properties.yield_seconds.description, /very large positive value/);
	assert.match(resultTool.definition.parameters.properties.yield_seconds.description, /not an agent timeout/);
	assert(!("wait_seconds" in resultTool.definition.parameters.properties));
	assert.match(resultTool.definition.description, /use a very large value/);
	assert.match(resultTool.definition.description, /leaves them working in the background/);
	assert(existsSync("skills/code-review/references/plan-review-verify.js"), "missing code-review planned reference");
	assert(existsSync("skills/code-review/references/multi-lens-review.js"), "missing code-review multi-lens reference");
	assert(existsSync("skills/code-review/references/residual-review-loop.js"), "missing code-review residual reference");
	assert(existsSync("skills/code-review/references/planner.md"), "missing code-review planner reference");
	assert(existsSync("skills/code-review/references/reviewer.md"), "missing code-review reviewer reference");
	assert(existsSync("skills/code-review/references/verifier.md"), "missing code-review verifier reference");
	assert(!existsSync("skills/review"), "legacy review skill directory must be absent");
	assert(!existsSync("skills/code-review/references/targeted-review.js"), "targeted review graph should be removed");
	assert(
		!existsSync("skills/code-review/references/security-baseline-review.js"),
		"security review should use the fixed multi-lens graph",
	);
	assert(existsSync("skills/ralph/references/ralph-simple.js"), "missing general Ralph reference");
	assert(existsSync("skills/ralph/references/ralph-ledger.js"), "missing ledger Ralph reference");
	assert(
		!existsSync("skills/ralph/references/ralph-ledger-review.js"),
		"duplicated reviewed Ralph graph must be absent",
	);
	for (const procedure of ["initialize", "ingest", "query", "maintain"]) {
		assert(existsSync(`skills/llm-wiki/references/${procedure}.md`), `missing llm-wiki ${procedure} procedure`);
	}
	console.log("apple-pi: all extension entrypoints loaded");
} finally {
	delete process.env.PI_CODING_AGENT_DIR;
	rmSync(temp, { recursive: true, force: true });
}
