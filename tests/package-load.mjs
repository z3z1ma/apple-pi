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
process.env.PI_VCC_CONFIG_PATH = join(temp, "vcc.json");
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
			"extensions/review.ts",
			"extensions/ralph.ts",
		],
		process.cwd(),
		eventBus,
		createExtensionRuntime(),
	);
	assert.deepEqual(result.errors, []);
	assert.equal(result.extensions.length, 8);

	const commands = new Set(result.extensions.flatMap((extension) => [...extension.commands.keys()]));
	const tools = new Set(result.extensions.flatMap((extension) => [...extension.tools.keys()]));
	for (const command of ["advisor", "pi-vcc", "pi-vcc-recall", "om:status", "om:view", "mcp", "mcp-auth", "agents", "review", "ralph"]) {
		assert(commands.has(command), `missing /${command}`);
	}
	for (const tool of ["ask_user_question", "vcc_recall", "recall", "pi_exec", "mcp", "Agent", "get_subagent_result", "steer_subagent", "review", "ralph"]) {
		assert(tools.has(tool), `missing ${tool} tool`);
	}
	assert(!tools.has("mcpScript"), "mcpScript duplicates pi_exec and must stay disabled");
	let managedService;
	eventBus.emit("apple-pi:managed-subagent-service:request", (service) => { managedService ??= service; });
	assert(managedService, "managed subagent service is not visible across isolated extension module graphs");
	const reviewTool = result.extensions.flatMap((extension) => [...extension.tools.values()]).find((tool) => tool.definition.name === "review");
	assert(reviewTool?.definition.parameters.properties.root, "review tool is missing the agent-selected root parameter");
	const reviewCommand = result.extensions.flatMap((extension) => [...extension.commands.values()]).find((command) => command.name === "review");
	assert(reviewCommand?.getArgumentCompletions, "review command is missing argument completions");
	const reviewActions = await reviewCommand.getArgumentCompletions("");
	assert.deepEqual(reviewActions.map(({ label }) => label), ["run", "preview", "status", "stop"]);
	const reviewSources = await reviewCommand.getArgumentCompletions("run ");
	assert(reviewSources.some(({ label, description }) => label === "workspace" && description), "review source hints are missing");
	const manifest = JSON.parse(readFileSync("package.json", "utf8"));
	assert.deepEqual(manifest.pi.skills, ["./skills"]);
	for (const skill of [
		"ledger-shape-task", "ledger-research-task", "ledger-specify-task", "ledger-plan-task", "ledger-execute-task", "ledger-distill-close-task",
		"ralph-executor", "ralph-judge", "review-planner", "reviewer", "review-verifier",
	]) {
		assert(existsSync(`skills/${skill}/SKILL.md`), `missing packaged skill: ${skill}`);
	}
	for (const obsolete of ["10x-shape-work", "ralph-reviewer", "apple-pi-review-planner", "apple-pi-reviewer", "apple-pi-review-verifier"]) assert(!existsSync(`skills/${obsolete}`), `obsolete skill remains: ${obsolete}`);
	const askUserTool = result.extensions.flatMap((extension) => [...extension.tools.values()]).find((tool) => tool.definition.name === "ask_user_question");
	assert(askUserTool, "missing ask_user_question tool definition");
	const questionSchema = askUserTool.definition.parameters.properties.questions.items;
	const optionSchema = questionSchema.properties.options.items;
	assert(!("preview" in optionSchema.properties), "deferred preview field leaked into ask_user_question schema");
	assert(!("notes" in questionSchema.properties), "deferred notes field leaked into ask_user_question schema");
	const ralphTool = result.extensions.flatMap((extension) => [...extension.tools.values()]).find((tool) => tool.definition.name === "ralph");
	assert(ralphTool.definition.parameters.properties.task, "ralph task parameter missing");
	assert(ralphTool.definition.parameters.properties.root, "ralph worktree root parameter missing");
	assert(ralphTool.definition.parameters.properties.ledger_root, "ralph ledger root parameter missing");
	assert(!ralphTool.definition.parameters.properties.ticket, "legacy ralph ticket parameter remains");
	const ralphCommand = result.extensions.flatMap((extension) => [...extension.commands.values()]).find((command) => command.name === "ralph");
	assert(ralphCommand?.getArgumentCompletions, "ralph command is missing argument completions");
	const ralphActions = await ralphCommand.getArgumentCompletions("");
	assert.deepEqual(ralphActions.map(({ label }) => label), ["inspect", "start", "step", "run", "status", "stop"]);
	const ralphOptions = await ralphCommand.getArgumentCompletions("run .ledger/tasks/example/task.md ");
	assert(ralphOptions.some(({ label, description }) => label === "--max-iterations" && description), "ralph budget hints are missing");
	assert(ralphOptions.some(({ label, description }) => label === "--root" && description), "ralph worktree hints are missing");
	assert(ralphOptions.some(({ label, description }) => label === "--ledger-root" && description), "ralph ledger hints are missing");
	const agentTool = result.extensions.flatMap((extension) => [...extension.tools.values()]).find((tool) => tool.definition.name === "Agent");
	assert(agentTool, "missing Agent tool definition");
	const agentProperties = agentTool.definition.parameters.properties;
	for (const removed of ["isolation", "schedule", "name"]) {
		assert(!(removed in agentProperties), `removed subagent field leaked into schema: ${removed}`);
	}
	console.log("apple-pi: all extension entrypoints loaded");
} finally {
	delete process.env.PI_VCC_CONFIG_PATH;
	delete process.env.PI_CODING_AGENT_DIR;
	rmSync(temp, { recursive: true, force: true });
}
