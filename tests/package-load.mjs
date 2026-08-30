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
			"extensions/backlog.ts",
			"extensions/context.ts",
			"extensions/auto-compact.ts",
			"extensions/codex-fast.ts",
			"extensions/runtime.ts",
			"extensions/mcp.ts",
			"extensions/subagents.ts",
			"extensions/ledger.ts",
			"extensions/workflow.ts",
			"extensions/xai-hosted-tools.ts",
			"extensions/xai-context-compaction.ts",
			"extensions/notify.ts",
			"extensions/tmux-sessions.ts",
			"extensions/status-footer.ts",
			"extensions/todos.ts",
		],
		process.cwd(),
		eventBus,
		createExtensionRuntime(),
	);
	assert.deepEqual(result.errors, []);
	assert.equal(result.extensions.length, 17);
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
				extension.path.endsWith("auto-compact.ts") && (extension.handlers.get("turn_end")?.length ?? 0) > 0,
		),
		"missing proactive auto-compaction guard",
	);
	assert(
		result.extensions.some(
			(extension) =>
				extension.path.endsWith("codex-fast.ts") &&
				(extension.handlers.get("before_provider_request")?.length ?? 0) > 0,
		),
		"missing Codex fast-mode provider hook",
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
	const workflowExtension = result.extensions.find((extension) => extension.path.endsWith("workflow.ts"));
	assert(workflowExtension, "missing root workflow extension");
	const workflowStart = workflowExtension.handlers.get("before_agent_start")?.[0];
	assert(workflowStart, "missing root workflow bootstrap injection");
	const workflowOnce = await workflowStart({ systemPrompt: "Root system prompt" });
	assert.equal((workflowOnce.systemPrompt.match(/<ledger-workflow>/g) ?? []).length, 1);
	const workflowTwice = await workflowStart({ systemPrompt: workflowOnce.systemPrompt });
	assert.equal((workflowTwice.systemPrompt.match(/<ledger-workflow>/g) ?? []).length, 1);
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
		"backlog",
		"fast",
		"notify-setup",
		"notify-test",
		"pi-sessions",
		"todos",
	]) {
		assert(commands.has(command), `missing /${command}`);
	}
	for (const tool of [
		"acknowledge_pair_findings",
		"ask_user_question",
		"backlog_add",
		"backlog_list",
		"backlog_take",
		"search_session",
		"revisit_note",
		"pi_exec",
		"pi_discover_programs",
		"pi_exec_program",
		"mcp",
		"Agent",
		"get_subagent_result",
		"steer_subagent",
		"ledger_add",
		"ledger_close",
		"todo_create",
		"todo_list",
		"todo_get",
		"todo_update",
		"todo_delete",
		"todo_execute",
		"todo_output",
		"todo_stop",
	]) {
		assert(tools.has(tool), `missing ${tool} tool`);
	}
	const piExecTool = result.extensions
		.flatMap((extension) => [...extension.tools.values()])
		.find((tool) => tool.definition.name === "pi_exec");
	const limits = piExecTool.definition.parameters.properties.limits?.properties;
	assert(limits, "pi_exec limits parameter missing");
	assert.equal(limits.agentBudget.maximum, 128);
	assert.equal(limits.callBudget.maximum, 2048);
	assert.equal(limits.concurrency.maximum, 32);
	assert.equal(limits.timeoutSeconds.maximum, 7200);
	let managedService;
	eventBus.emit("apple-pi:managed-subagent-service:request", (service) => {
		managedService ??= service;
	});
	assert(managedService, "managed subagent service is not visible across isolated extension module graphs");
	const manifest = JSON.parse(readFileSync("package.json", "utf8"));
	assert.deepEqual(manifest.pi.skills, ["./skills"]);
	assert.deepEqual(manifest.pi.prompts, ["./prompts"]);
	assert(manifest.pi.extensions.includes("./extensions/workflow.ts"), "package manifest omits root workflow extension");
	assert(manifest.pi.extensions.includes("./extensions/codex-fast.ts"), "package manifest omits Codex fast mode");
	assert(manifest.pi.extensions.includes("./extensions/todos.ts"), "package manifest omits todos extension");
	assert(manifest.files.includes("components/codex-fast/src/"), "package manifest omits Codex fast-mode source");
	assert(manifest.files.includes("components/todos/src/"), "package manifest omits todos source");
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
		["distill"],
	);
	const distillTemplate = promptTemplates[0];
	assert.equal(distillTemplate.argumentHint, "[focus]");
	assert.match(distillTemplate.description, /durable knowledge and reusable harness artifacts/);
	assert.match(expandPromptTemplate("/distill", promptTemplates), /the most recent meaningful body of work/);
	assert.match(expandPromptTemplate("/distill debugging workflow", promptTemplates), /focused on: debugging workflow/);
	assert.match(distillTemplate.content, /AGENTS\.md/);
	assert.match(distillTemplate.content, /do not create or modify artifacts/i);
	const ledgerLifecycleSkills = [
		"task-shaping",
		"implementation-planning",
		"plan-execution",
		"work-item-orchestration",
		"parallel-orchestration",
		"root-cause-debugging",
		"test-first-development",
		"review-commissioning",
		"review-reconciliation",
		"completion-verification",
		"workspace-isolation",
		"task-closure",
		"skill-authoring",
	];
	const piUtilitySkills = ["pi-exec", "review", "ralph", "llm-wiki"];
	const packagedSkills = [...ledgerLifecycleSkills, ...piUtilitySkills];
	const loadedSkills = loadSkills({
		cwd: process.cwd(),
		skillPaths: manifest.pi.skills,
		includeDefaults: false,
		agentDir: temp,
	});
	assert.deepEqual(loadedSkills.diagnostics, []);
	assert.deepEqual(loadedSkills.skills.map((skill) => skill.name).sort(), packagedSkills.toSorted());
	for (const skill of loadedSkills.skills) {
		assert.equal(skill.filePath.split("/").at(-2), skill.name, `skill directory/name mismatch: ${skill.filePath}`);
	}
	for (const skill of packagedSkills) {
		assert(existsSync(`skills/${skill}/SKILL.md`), `missing packaged skill: ${skill}`);
	}
	for (const visualPath of [
		"skills/task-shaping/visual-companion.md",
		"skills/task-shaping/scripts/frame-template.html",
		"skills/task-shaping/scripts/helper.js",
		"skills/task-shaping/scripts/server.cjs",
		"skills/task-shaping/scripts/start-server.sh",
		"skills/task-shaping/scripts/stop-server.sh",
	]) {
		assert(existsSync(visualPath), `missing Ledger brainstorming support: ${visualPath}`);
	}
	const askUserTool = result.extensions
		.flatMap((extension) => [...extension.tools.values()])
		.find((tool) => tool.definition.name === "ask_user_question");
	assert(askUserTool, "missing ask_user_question tool definition");
	const agentTool = result.extensions
		.flatMap((extension) => [...extension.tools.values()])
		.find((tool) => tool.definition.name === "Agent");
	assert(agentTool, "missing Agent tool definition");
	assert.match(agentTool.definition.description, /<subagent-team>/);
	assert.match(
		agentTool.definition.description,
		/lists everyone available, including each teammate's configured inference profile and own description/,
	);
	assert.match(agentTool.definition.description, /<inference-profiles>/);
	assert.match(agentTool.definition.description, /system_prompt only for invocation-specific guidance/);
	assert.match(piExecTool.definition.description, /<subagent-team>/);
	assert.match(piExecTool.definition.description, /callable teammates with name, inference profile, and description/);
	assert.match(piExecTool.definition.description, /<inference-profiles>/);
	assert.match(piExecTool.definition.description, /profile selects an inference profile/);
	assert.match(piExecTool.definition.description, /systemPrompt appends dynamic specialization/);
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
	assert(existsSync("skills/review/references/plan-review-verify.js"), "missing review plan-review-verify reference");
	assert(existsSync("skills/review/references/targeted-review.js"), "missing review targeted-review reference");
	assert(existsSync("skills/review/references/multi-lens-review.js"), "missing review multi-lens reference");
	assert(
		existsSync("skills/review/references/security-baseline-review.js"),
		"missing review security-baseline reference",
	);
	assert(existsSync("skills/review/references/residual-review-loop.js"), "missing review residual-loop reference");
	assert(existsSync("skills/review/references/planner.md"), "missing review planner reference");
	assert(existsSync("skills/review/references/reviewer.md"), "missing review reviewer reference");
	assert(existsSync("skills/review/references/verifier.md"), "missing review verifier reference");
	assert(existsSync("skills/ralph/references/ralph-simple.js"), "missing general Ralph reference");
	assert(existsSync("skills/ralph/references/ralph-ledger.js"), "missing Ledger Ralph reference");
	assert(existsSync("skills/ralph/references/ralph-ledger-review.js"), "missing reviewed Ledger Ralph reference");
	console.log("apple-pi: all extension entrypoints loaded");
} finally {
	delete process.env.PI_CODING_AGENT_DIR;
	rmSync(temp, { recursive: true, force: true });
}
