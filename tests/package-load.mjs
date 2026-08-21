import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createEventBus } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/event-bus.js";
import {
	createExtensionRuntime,
	loadExtensions,
} from "../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js";

const temp = mkdtempSync(join(tmpdir(), "apple-pi-load-"));
process.env.PI_CODING_AGENT_DIR = temp;
try {
	const eventBus = createEventBus();
	const result = await loadExtensions(
		[
			"extensions/pi-advisor.ts",
			"extensions/ask-user-question.ts",
			"extensions/context.ts",
			"extensions/runtime.ts",
			"extensions/mcp.ts",
			"extensions/subagents.ts",
			"extensions/ledger.ts",
			"extensions/xai-hosted-tools.ts",
			"extensions/xai-context-compaction.ts",
			"extensions/notify.ts",
			"extensions/tmux-sessions.ts",
		],
		process.cwd(),
		eventBus,
		createExtensionRuntime(),
	);
	assert.deepEqual(result.errors, []);
	assert.equal(result.extensions.length, 11);
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
				extension.path.endsWith("subagents.ts") && (extension.handlers.get("before_agent_start")?.length ?? 0) > 0,
		),
		"missing live subagent-team system-prompt injection",
	);

	const commands = new Set(result.extensions.flatMap((extension) => [...extension.commands.keys()]));
	const tools = new Set(result.extensions.flatMap((extension) => [...extension.tools.keys()]));
	for (const command of [
		"advisor",
		"om:status",
		"om:view",
		"mcp",
		"mcp-auth",
		"agents",
		"notify-setup",
		"notify-test",
		"pi-sessions",
	]) {
		assert(commands.has(command), `missing /${command}`);
	}
	for (const obsolete of ["ralph", "harness", "ledger"]) {
		assert(!commands.has(obsolete), `obsolete /${obsolete} command remains`);
	}
	for (const tool of [
		"ask_user_question",
		"session_search",
		"memory_source",
		"pi_exec",
		"mcp",
		"Agent",
		"get_subagent_result",
		"steer_subagent",
		"ledger_add",
		"ledger_close",
	]) {
		assert(tools.has(tool), `missing ${tool} tool`);
	}
	for (const obsolete of ["ralph", "ledger", "vcc_recall", "recall"]) {
		assert(!tools.has(obsolete), `obsolete ${obsolete} tool remains`);
	}
	assert(!tools.has("mcpScript"), "mcpScript duplicates pi_exec and must stay disabled");
	const piExecTool = result.extensions
		.flatMap((extension) => [...extension.tools.values()])
		.find((tool) => tool.definition.name === "pi_exec");
	for (const leaked of ["callBudget", "concurrency", "memoryMb", "agentBudget", "timeoutSeconds"])
		assert(!(leaked in piExecTool.definition.parameters.properties), `pi_exec caller budget leaked: ${leaked}`);
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
	for (const skill of [
		"ledger-shape-task",
		"ledger-research-task",
		"ledger-specify-task",
		"ledger-plan-task",
		"ledger-execute-task",
		"ledger-distill-close-task",
		"pi-ralph",
		"pi-review",
		"pi-exec",
	]) {
		assert(existsSync(`skills/${skill}/SKILL.md`), `missing packaged skill: ${skill}`);
	}
	for (const obsoletePath of ["components/ledger", "components/operations", "extensions/harness.ts"]) {
		assert(!existsSync(obsoletePath), `obsolete ledger runtime remains: ${obsoletePath}`);
	}
	for (const obsolete of [
		"ralph-executor",
		"ralph-judge",
		"ralph-reviewer",
		"review",
		"review-planner",
		"reviewer",
		"review-verifier",
		"apple-pi-review-planner",
		"apple-pi-reviewer",
		"apple-pi-review-verifier",
	])
		assert(!existsSync(`skills/${obsolete}`), `obsolete skill remains: ${obsolete}`);
	const askUserTool = result.extensions
		.flatMap((extension) => [...extension.tools.values()])
		.find((tool) => tool.definition.name === "ask_user_question");
	assert(askUserTool, "missing ask_user_question tool definition");
	const questionSchema = askUserTool.definition.parameters.properties.questions.items;
	const optionSchema = questionSchema.properties.options.items;
	assert(!("preview" in optionSchema.properties), "deferred preview field leaked into ask_user_question schema");
	assert(!("notes" in questionSchema.properties), "deferred notes field leaked into ask_user_question schema");
	const agentTool = result.extensions
		.flatMap((extension) => [...extension.tools.values()])
		.find((tool) => tool.definition.name === "Agent");
	assert(agentTool, "missing Agent tool definition");
	assert.match(agentTool.definition.description, /<subagent-team>/);
	assert.match(
		agentTool.definition.description,
		/every callable teammate with its name, configured inference profile, and own description/,
	);
	assert.match(agentTool.definition.description, /<inference-profiles>/);
	assert.match(agentTool.definition.description, /dynamic guidance with system_prompt/);
	assert.match(piExecTool.definition.description, /<subagent-team>/);
	assert.match(piExecTool.definition.description, /callable teammates with name, inference profile, and description/);
	assert.match(piExecTool.definition.description, /<inference-profiles>/);
	assert.match(piExecTool.definition.description, /profile selects an inference profile/);
	assert.match(piExecTool.definition.description, /systemPrompt appends dynamic specialization/);
	const agentProperties = agentTool.definition.parameters.properties;
	assert("profile" in agentProperties, "Agent schema omits the inference profile selector");
	assert.deepEqual(
		agentProperties.profile.anyOf.map((entry) => entry.const),
		["quick", "balanced", "deep", "coding", "visual-engineering", "background"],
	);
	assert("system_prompt" in agentProperties, "Agent schema omits invocation-level system guidance");
	assert.match(
		agentProperties.system_prompt.description,
		/appended after the selected definition and preloaded skills/,
	);
	assert.match(agentProperties.system_prompt.description, /cannot change capabilities/);
	for (const removed of ["isolation", "schedule", "name", "max_turns", "model", "thinking"]) {
		assert(!(removed in agentProperties), `removed subagent field leaked into schema: ${removed}`);
	}
	assert(
		!agentTool.definition.parameters.required.includes("advisor"),
		"advisor must remain optional for config defaults",
	);
	const resultTool = result.extensions
		.flatMap((extension) => [...extension.tools.values()])
		.find((tool) => tool.definition.name === "get_subagent_result");
	assert(!resultTool.definition.parameters.required.includes("yield_seconds"));
	assert(!("maximum" in resultTool.definition.parameters.properties.yield_seconds));
	assert.match(resultTool.definition.parameters.properties.yield_seconds.description, /very large positive value/);
	assert.match(resultTool.definition.parameters.properties.yield_seconds.description, /not an agent timeout/);
	assert(!("wait_seconds" in resultTool.definition.parameters.properties));
	assert.match(resultTool.definition.description, /use a very large yield_seconds value/);
	assert.match(resultTool.definition.description, /not an agent timeout/);
	assert(
		existsSync("skills/pi-review/references/plan-review-verify.js"),
		"missing pi-review plan-review-verify reference",
	);
	assert(existsSync("skills/pi-review/references/targeted-review.js"), "missing pi-review targeted-review reference");
	assert(existsSync("skills/pi-review/references/multi-lens-review.js"), "missing pi-review multi-lens reference");
	assert(
		existsSync("skills/pi-review/references/security-baseline-review.js"),
		"missing pi-review security-baseline reference",
	);
	assert(
		existsSync("skills/pi-review/references/residual-review-loop.js"),
		"missing pi-review residual-loop reference",
	);
	assert(existsSync("skills/pi-review/references/planner.md"), "missing pi-review planner reference");
	assert(existsSync("skills/pi-review/references/reviewer.md"), "missing pi-review reviewer reference");
	assert(existsSync("skills/pi-review/references/verifier.md"), "missing pi-review verifier reference");
	assert(existsSync("skills/pi-ralph/references/ralph.js"), "missing pi-ralph reference");
	assert(
		existsSync("skills/pi-ralph/references/ralph-reviewed.js"),
		"missing advanced pi-ralph review composition reference",
	);
	const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
	for (const [program, prompts] of [
		["plan-review-verify.js", ["PLANNER", "REVIEWER", "VERIFIER"]],
		["targeted-review.js", ["REVIEWER", "VERIFIER"]],
		["multi-lens-review.js", ["REVIEWER", "VERIFIER"]],
		["security-baseline-review.js", ["ATTACKER", "DEFENDER", "VERIFIER"]],
		["residual-review-loop.js", ["REVIEWER", "TRIAGE_VERIFIER", "FINAL_VERIFIER"]],
	]) {
		const source = readFileSync(`skills/pi-review/references/${program}`, "utf8");
		assert.doesNotThrow(() => new AsyncFunction("inputs", source), `${program} must parse as a pi_exec body`);
		for (const constant of prompts)
			assert(
				new RegExp(`const ${constant}\\s*=\\s*"<adapt `).test(source),
				`${program} must declare an adaptable ${constant} prompt`,
			);
	}
	for (const [program, prompts] of [
		["ralph.js", ["RALPH"]],
		["ralph-reviewed.js", ["PLANNER", "REVIEWER", "VERIFIER", "RALPH"]],
	]) {
		const source = readFileSync(`skills/pi-ralph/references/${program}`, "utf8");
		assert.doesNotThrow(() => new AsyncFunction("inputs", source), `${program} must parse as a pi_exec body`);
		for (const constant of prompts)
			assert(
				new RegExp(`const ${constant}\\s*=\\s*"<adapt `).test(source),
				`${program} must declare an adaptable ${constant} prompt`,
			);
	}
	const defaultAgentsSource = readFileSync("components/subagents/src/default-agents.ts", "utf8");
	assert(!defaultAgentsSource.includes('name: "general-purpose"'), "retired built-in general-purpose agent remains");
	assert(!defaultAgentsSource.includes("model:"), "built-in agents must not embed concrete models");
	assert(!defaultAgentsSource.includes("thinking:"), "built-in agents must not embed raw thinking levels");
	assert(existsSync("components/shared/src/model-profiles.ts"), "model profile authority is missing");
	assert(!existsSync("components/shared/src/mode-utils.ts"), "legacy modes parser remains");
	assert(!existsSync("components/subagents/src/model-resolver.ts"), "legacy fuzzy model resolver remains");
	const docs = {
		ledger: readFileSync("docs/ledger.md", "utf8"),
		readme: readFileSync("README.md", "utf8"),
	};
	assert(docs.ledger.includes("ledger_add"), "ledger docs omit the add tool");
	assert(docs.ledger.includes("ledger_close"), "ledger docs omit the close tool");
	assert(docs.ledger.includes(".ledger/history/"), "ledger docs omit history archival");
	assert(!docs.ledger.includes("/harness"), "obsolete /harness docs remain");
	assert(!docs.ledger.includes("last-valid-entry-wins"), "obsolete active-task pointer docs remain");
	assert(docs.readme.includes("ledger_add"), "README omits the add tool");
	assert(docs.readme.includes("/skill:pi-ralph"), "README omits /skill:pi-ralph");
	console.log("apple-pi: all extension entrypoints loaded");
} finally {
	delete process.env.PI_CODING_AGENT_DIR;
	rmSync(temp, { recursive: true, force: true });
}
