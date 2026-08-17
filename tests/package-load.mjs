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
			"extensions/harness.ts",
			"extensions/xai-hosted-tools.ts",
		],
		process.cwd(),
		eventBus,
		createExtensionRuntime(),
	);
	assert.deepEqual(result.errors, []);
	assert.equal(result.extensions.length, 8);
	assert(
		result.extensions.some(
			(extension) =>
				extension.path.includes("xai-hosted-tools") &&
				(extension.handlers.get("before_provider_request")?.length ?? 0) > 0,
		),
		"missing xAI hosted tools before_provider_request hook",
	);

	const commands = new Set(result.extensions.flatMap((extension) => [...extension.commands.keys()]));
	const tools = new Set(result.extensions.flatMap((extension) => [...extension.tools.keys()]));
	for (const command of [
		"advisor",
		"pi-vcc",
		"pi-vcc-recall",
		"om:status",
		"om:view",
		"mcp",
		"mcp-auth",
		"agents",
		"harness",
		"ledger",
	]) {
		assert(commands.has(command), `missing /${command}`);
	}
	assert(!commands.has("ralph"), "obsolete /ralph command remains");
	for (const tool of [
		"ask_user_question",
		"vcc_recall",
		"recall",
		"pi_exec",
		"mcp",
		"Agent",
		"get_subagent_result",
		"steer_subagent",
		"ledger",
	]) {
		assert(tools.has(tool), `missing ${tool} tool`);
	}
	assert(!tools.has("ralph"), "obsolete ralph tool remains");
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
	for (const channel of ["apple-pi:operations-runtime:request"]) {
		let discovered;
		eventBus.emit(channel, (service) => {
			discovered ??= service;
		});
		assert(discovered, `missing operations channel ${channel}`);
	}
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
	for (const obsolete of [
		"10x-shape-work",
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
	const agentProperties = agentTool.definition.parameters.properties;
	for (const removed of ["isolation", "schedule", "name", "max_turns"]) {
		assert(!(removed in agentProperties), `removed subagent field leaked into schema: ${removed}`);
	}
	assert(
		existsSync("skills/pi-review/references/plan-review-verify.js"),
		"missing pi-review plan-review-verify reference",
	);
	assert(existsSync("skills/pi-review/references/targeted-review.js"), "missing pi-review targeted-review reference");
	assert(existsSync("skills/pi-review/references/planner.md"), "missing pi-review planner reference");
	assert(existsSync("skills/pi-review/references/reviewer.md"), "missing pi-review reviewer reference");
	assert(existsSync("skills/pi-review/references/verifier.md"), "missing pi-review verifier reference");
	assert(existsSync("skills/pi-ralph/references/ralph.js"), "missing pi-ralph reference");
	for (const [program, prompts] of [
		["plan-review-verify.js", ["planner", "reviewer", "verifier"]],
		["targeted-review.js", ["reviewer", "verifier"]],
	]) {
		const source = readFileSync(`skills/pi-review/references/${program}`, "utf8");
		for (const prompt of prompts) {
			const constant = prompt.toUpperCase();
			assert(
				source.includes(`const ${constant} = "<copy references/${prompt}.md>";`),
				`${program} must declare the ${constant} prompt placeholder`,
			);
		}
		assert(!source.includes("skills.body"), `${program} must not load role prompts via skills.body`);
		assert(!source.includes("skillBody"), `${program} must not recreate skillBody`);
	}
	const ralphSource = readFileSync("skills/pi-ralph/references/ralph.js", "utf8");
	assert(ralphSource.includes('type: "general-purpose"'), "pi-ralph must use a general-purpose increment worker");
	assert(
		/agents\.run\(\{\s*type: "general-purpose",\s*name: `ralph-\$\{iteration\}`/.test(ralphSource),
		"pi-ralph increment must be an unprompted general-purpose worker",
	);
	assert(
		!/type: "general-purpose"[\s\S]{0,200}systemPrompt:/.test(ralphSource),
		"pi-ralph must not override the increment system prompt",
	);
	assert(!/type: "general-purpose"[\s\S]{0,200}tools:/.test(ralphSource), "pi-ralph must not restrict increment tools");
	assert(ralphSource.includes("const PLANNER"), "pi-ralph must inline the review planner prompt");
	assert(ralphSource.includes("workspaceSnapshot"), "pi-ralph must snapshot the workspace before each increment");
	assert(ralphSource.includes("isLedgerPath"), "pi-ralph must separate ledger memory from product deltas");
	assert(/Leave the increment uncommitted/.test(ralphSource), "pi-ralph must leave increments uncommitted for review");
	const docs = {
		ledger: readFileSync("docs/ledger.md", "utf8"),
		readme: readFileSync("README.md", "utf8"),
	};
	assert(docs.ledger.includes("/harness"), "ledger docs omit /harness");
	assert(docs.ledger.includes("last-valid-entry-wins"), "ledger docs omit pointer folding");
	assert(docs.ledger.includes("mutateTaskWorkItems"), "ledger docs omit WI mutation authority");
	assert(docs.readme.includes("/harness"), "README omits /harness");
	assert(docs.readme.includes("/skill:pi-ralph"), "README omits /skill:pi-ralph");
	console.log("apple-pi: all extension entrypoints loaded");
} finally {
	delete process.env.PI_VCC_CONFIG_PATH;
	delete process.env.PI_CODING_AGENT_DIR;
	rmSync(temp, { recursive: true, force: true });
}
