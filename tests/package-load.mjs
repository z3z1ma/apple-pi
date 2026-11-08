import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { TOOL_GROUPS, toolboxSection } from "../components/system-prompt/src/toolbox.ts";

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
	const manifest = JSON.parse(readFileSync("package.json", "utf8"));
	const result = await loadExtensions(
		manifest.pi.extensions,
		process.cwd(),
		createEventBus(),
		createExtensionRuntime(),
	);
	assert.deepEqual(result.errors, []);
	assert.equal(result.extensions.length, manifest.pi.extensions.length);
	assert(
		result.extensions.some(
			(extension) =>
				extension.path.endsWith("tmux-sessions.ts") &&
				(extension.handlers.get("session_start")?.length ?? 0) > 0 &&
				(extension.handlers.get("agent_settled")?.length ?? 0) > 0,
		),
		"missing tmux-sessions plugin and bell hooks",
	);
	assert(
		result.extensions.some((extension) => extension.path.endsWith("input-editor.ts")),
		"missing input card extension",
	);
	assert(
		result.extensions.some((extension) => extension.path.endsWith("terse-tools.ts")),
		"missing terse tools extension",
	);
	assert(
		result.extensions.some(
			(extension) =>
				extension.path.endsWith("browser-pages.ts") &&
				extension.tools.has("sign_off_code") &&
				extension.tools.has("sign_off_document") &&
				extension.tools.has("sign_off_task") &&
				extension.tools.has("explain_change") &&
				(extension.handlers.get("session_shutdown")?.length ?? 0) > 0,
		),
		"missing a browser page tool (sign_off_code, sign_off_document, sign_off_task, explain_change)",
	);
	assert(
		result.extensions.some(
			(extension) =>
				extension.path.endsWith("change-reflection.ts") &&
				(extension.handlers.get("agent_before_settle")?.length ?? 0) > 0,
		),
		"missing change reflection settle hook",
	);
	assert(
		result.extensions.some(
			(extension) =>
				extension.path.endsWith("auto-compact.ts") &&
				(extension.handlers.get("session_compact_failed")?.length ?? 0) > 0,
		),
		"missing automatic-compaction failure safety",
	);
	assert(
		result.extensions.some(
			(extension) =>
				extension.path.endsWith("anthropic-watchdog.ts") &&
				(extension.handlers.get("session_start")?.length ?? 0) > 0 &&
				(extension.handlers.get("session_shutdown")?.length ?? 0) > 0,
		),
		"missing Anthropic request-watchdog lifecycle hooks",
	);
	assert(
		result.extensions.some(
			(extension) =>
				extension.path.endsWith("provider-failover.ts") &&
				(extension.handlers.get("turn_end")?.length ?? 0) > 0 &&
				(extension.handlers.get("agent_before_settle")?.length ?? 0) > 0 &&
				(extension.handlers.get("session_shutdown")?.length ?? 0) > 0,
		),
		"missing failure-only provider recovery lifecycle hooks",
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
				extension.path.endsWith("code-context.ts") &&
				(extension.handlers.get("tool_call")?.length ?? 0) > 0 &&
				(extension.handlers.get("tool_result")?.length ?? 0) > 0,
		),
		"missing code context file delivery and edit gate",
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
				extension.path.endsWith("system-prompt.ts") && (extension.handlers.get("before_agent_start")?.length ?? 0) > 0,
		),
		"missing the system-prompt composer",
	);
	assert.match(toolboxSection(["search_session"], {}, {}), /\*\*The ledger\*\*: .*`\.ledger\/INDEX\.md`/);
	assert(
		!result.extensions.some((extension) => extension.path.endsWith("workflow.ts")),
		"default package must not load a workflow extension",
	);
	assert(
		!result.extensions.some((extension) => extension.path.endsWith("subagents.ts")),
		"the package must not load the removed subagent system",
	);
	assert(
		result.extensions.some((extension) => extension.path.endsWith("rtk.ts")),
		"missing rtk extension",
	);
	assert(
		result.extensions.some(
			(extension) =>
				extension.path.endsWith("branch-search.ts") && (extension.handlers.get("session_shutdown")?.length ?? 0) > 0,
		),
		"missing branch search shutdown hook",
	);

	const commands = new Set(result.extensions.flatMap((extension) => [...extension.commands.keys()]));
	const tools = new Set(result.extensions.flatMap((extension) => [...extension.tools.keys()]));
	const grouped = new Set(TOOL_GROUPS.flatMap((group) => group.tools));
	const toolbox = toolboxSection([...tools], {}, {});
	for (const tool of result.extensions.flatMap((extension) => [...extension.tools.values()])) {
		if (!grouped.has(tool.definition.name)) continue;
		assert(!Object.hasOwn(tool.definition, "promptSnippet"), `${tool.definition.name} has a dead promptSnippet`);
		assert(!Object.hasOwn(tool.definition, "promptGuidelines"), `${tool.definition.name} has dead promptGuidelines`);
	}
	for (const command of [
		"pair",
		"reviews",
		"btw",
		"fast",
		"notify-setup",
		"notify-test",
		"pi-sessions",
		"org",
		"incorporate",
		"stash",
		"edit-prompt",
		"inspect-tool",
		"workplace",
	]) {
		assert(commands.has(command), `missing /${command}`);
	}
	assert(
		result.extensions.some((extension) => extension.flags.get("incorporate")?.type === "boolean"),
		"missing boolean --incorporate flag",
	);
	assert(!commands.has("branch-search"), "branch search is the model's tool; there is no /branch-search command");
	assert(!commands.has("work") && !commands.has("tasks"), "the combined work panel is retired");
	assert(!commands.has("world"), "/workplace opens the app; World is its tab, not a command");
	const reviewCommandCount = result.extensions.reduce(
		(count, extension) => count + Number(extension.commands.has("reviews")),
		0,
	);
	assert(reviewCommandCount === 1, `expected exactly one /reviews registration, got ${reviewCommandCount}`);
	const communicationTools = [
		"send_mail",
		"reply",
		"inbox",
		"read_thread",
		"post",
		"escalate",
		"create_channel",
		"find_channels",
		"join_channel",
		"leave_thread",
		"invite_to_thread",
		"remove_thread_invitation",
		"search_messages",
		"pin_message",
		"react",
		"archive_thread",
		"reopen_thread",
		"communication_status",
	];
	for (const tool of [
		"acknowledge_pair_findings",
		"update_notebook",
		"ask_user_question",
		"remind_me",
		"monitor",
		...communicationTools,
		"search_session",
		"revisit_note",
		"temporary_peer",
		"colleague",
		"review_code",
		"review_queue",
		"read_review",
		"manage_review",
		"resolve_finding",
		"explore",
		"research",
		"ledger_add",
		"ledger_status",
		"wiki_lint",
		"wiki_references",
		"context_lint",
		"repo_rules",
		"replay_rule",
		"session_evidence",
		"compare_program",
		"tlc_check",
		"tla_symbolic_check",
		"alloy_check",
		"lean_check",
		"task",
		"bash",
		"search_branches",
	]) {
		assert(tools.has(tool), `missing ${tool} tool`);
	}
	for (const name of [
		"mcp",
		"mcpScript",
		"pi_exec_program",
		"ask_for_second_opinion",
		"ask_consultant",
		"agent",
		"get_subagent_result",
		"steer_subagent",
		"stop_subagent",
		"standup",
		"meet",
		"end_meeting",
		"schedule",
		"list_peer_sessions",
		"start_peer_session",
		"reopen_peer_session",
		"close_peer_session",
		"rename_peer_session",
		"transfer_peer_session",
		"retire_peer_session",
	]) {
		assert(!tools.has(name), `default package must not expose ${name}`);
	}
	for (const name of ["agents", "mcp", "mcp-auth"]) assert(!commands.has(name), `package must not register /${name}`);
	const scheduleTool = result.extensions
		.flatMap((extension) => [...extension.tools.values()])
		.find((tool) => tool.definition.name === "remind_me");
	assert(scheduleTool, "missing remind_me tool");
	const scheduleSchema = scheduleTool.definition.parameters;
	assert.equal(scheduleSchema.type, "object");
	assert.deepEqual(Object.keys(scheduleSchema.properties), ["delay_seconds", "text", "command"]);
	assert.deepEqual(scheduleSchema.required, ["delay_seconds"]);
	assert.equal(scheduleSchema.oneOf, undefined);
	const monitorTool = result.extensions
		.flatMap((extension) => [...extension.tools.values()])
		.find((tool) => tool.definition.name === "monitor");
	assert(monitorTool, "missing monitor tool");
	assert.deepEqual(Object.keys(monitorTool.definition.parameters.properties), ["command", "max_events"]);
	assert.deepEqual(monitorTool.definition.parameters.required, ["command"]);
	assert.match(toolbox, /`monitor` turns every line a line-buffered command prints into a nudge/);
	assert(
		result.extensions.some(
			(extension) =>
				extension.path.endsWith("tasks.ts") &&
				extension.tools.has("remind_me") &&
				extension.tools.has("monitor") &&
				extension.tools.has("task"),
		),
		"tasks extension must own remind_me, monitor, and task",
	);
	assert(
		result.extensions.some(
			(extension) =>
				extension.path.endsWith("session-state.ts") &&
				communicationTools.every((name) => extension.tools.has(name)) &&
				extension.tools.has("directory") &&
				extension.tools.has("hire") &&
				extension.tools.has("call_in") &&
				!extension.tools.has("rehire") &&
				extension.tools.has("send_home") &&
				extension.tools.has("rename") &&
				extension.tools.has("move") &&
				extension.tools.has("let_go") &&
				!extension.tools.has("meet") &&
				!extension.tools.has("end_meeting") &&
				extension.tools.has("take_task") &&
				extension.tools.has("assign") &&
				extension.tools.has("unassign") &&
				extension.tools.has("focus") &&
				extension.tools.has("finish_task") &&
				extension.tools.has("promote_task") &&
				extension.tools.has("link") &&
				extension.tools.has("schedule_mail") &&
				extension.tools.has("channel_charter") &&
				extension.tools.has("follow_external") &&
				extension.tools.has("unfollow_external") &&
				extension.tools.has("watch_repository") &&
				extension.tools.has("economics") &&
				extension.tools.has("predictions") &&
				!extension.tools.has("fitness") &&
				extension.tools.has("experience") &&
				extension.tools.has("bottlenecks") &&
				extension.tools.has("progress") &&
				extension.tools.has("coordination") &&
				extension.tools.has("update_self"),
		),
		"session-state extension must own the mail, directory, manager, and self tools",
	);

	for (const oldName of ["org_work", "org_waits", "org_communication", "org_expertise", "org_fitness"]) {
		assert(
			result.extensions.every((extension) => !extension.tools.has(oldName)),
			`${oldName} has been replaced`,
		);
	}
	const fitnessTool = result.extensions
		.flatMap((extension) => [...extension.tools.values()])
		.find((tool) => tool.definition.name === "economics");
	assert(
		fitnessTool?.definition.description.includes("optional instrument") &&
			fitnessTool.definition.description.includes("not an objective") &&
			["bottlenecks", "progress"].every((name) => fitnessTool.definition.description.includes(name)),
		"economics must teach optional economic comparison alongside inspection",
	);
	assert(
		fitnessTool.definition.parameters.type === "object" &&
			fitnessTool.definition.parameters.properties.scenarios &&
			fitnessTool.definition.parameters.properties.since &&
			!fitnessTool.definition.parameters.required?.includes("since"),
		"economics must expose scenario/window alternatives as root object properties",
	);

	const searchBranchesTool = result.extensions
		.flatMap((extension) => [...extension.tools.values()])
		.find((tool) => tool.definition.name === "search_branches");
	assert(
		result.extensions.some(
			(extension) => extension.path.endsWith("branch-search.ts") && extension.tools.has("search_branches"),
		),
		"branch search extension must own search_branches",
	);
	const searchParameters = searchBranchesTool.definition.parameters.properties;
	assert.deepEqual(Object.keys(searchParameters), ["goal", "judges", "gates", "protect"]);
	assert.deepEqual(Object.keys(searchParameters.judges.items.properties), [
		"command",
		"better",
		"repeat",
		"timeoutSec",
	]);
	assert.deepEqual(
		searchParameters.gates.items.anyOf.map((gate) => gate.type),
		["string", "object"],
		"gates take plain command strings or { command, timeoutSec }",
	);
	assert.deepEqual(searchBranchesTool.definition.parameters.required, ["goal", "judges"]);
	assert.equal(searchBranchesTool.definition.executionMode, "sequential");
	for (const taught of [
		/several approaches in their own worktrees/,
		/gated by tests and scored by judge commands you write/,
		/Protect the files the judges read/,
	])
		assert.match(toolbox, taught);

	assert.match(toolboxSection(["codemode"], {}, {}), /\*\*Programs\*\* \(`codemode`\)/);
	for (const peerTool of ["temporary_peer", "colleague"])
		assert.equal(
			result.extensions
				.flatMap((extension) => [...extension.tools.values()])
				.find((tool) => tool.definition.name === peerTool)?.definition.exposure,
			"codemode",
			`${peerTool} is callable only from scripts`,
		);
	assert.equal(manifest.dependencies["pi-mcp-adapter"], undefined, "MCP belongs to Pi");
	assert(!existsSync("extensions/mcp.ts"), "removed MCP wrapper must be absent");
	assert.deepEqual(manifest.pi.skills, ["./skills"]);
	assert.deepEqual(manifest.pi.prompts, ["./prompts"]);
	assert(
		result.extensions.some((extension) => extension.path.endsWith("prompt-stash.ts")),
		"missing prompt stash extension",
	);
	assert(manifest.files.includes("components/vroom/src/"), "package manifest omits vroom (fast mode) source");
	assert(
		manifest.files.includes("components/home-search-guard/src/"),
		"package manifest omits home search guard source",
	);
	assert(
		!manifest.files.includes("components/reminders/src/"),
		"package manifest must not include removed reminders source",
	);
	assert(manifest.files.includes("components/wiki/src/"), "package manifest omits wiki source");
	assert(manifest.files.includes("components/code-context/src/"), "package manifest omits code context source");
	assert(manifest.files.includes("components/tasks/src/"), "package manifest omits tasks source");
	assert(manifest.files.includes("components/prompt-stash/src/"), "package manifest omits prompt-stash source");
	assert(
		manifest.files.includes("components/change-reflection/src/"),
		"package manifest omits change reflection source",
	);
	for (const path of ["apps/agent-workplace/src/", "apps/agent-workplace/dist/", "apps/agent-workplace/themes/"])
		assert(manifest.files.includes(path), `package manifest omits ${path}`);
	assert(
		!manifest.files.some(
			(path) => path.startsWith("apps/agent-workplace/art") || path === "apps/" || path === "apps/agent-workplace/",
		),
		"Agent Workplace's raw art and generation inputs stay in the repository",
	);
	assert(manifest.files.includes("skills/"), "package manifest omits skills");
	assert(!manifest.files.includes("specs/"), "apple-pi's own TLA+ models stay repository content");
	assert(manifest.files.includes("prompts/"), "package manifest omits prompt templates");
	assert(manifest.files.includes("docs/"), "package manifest omits documentation");
	const { templates: promptTemplates, diagnostics: promptDiagnostics } = loadPromptTemplates({
		cwd: process.cwd(),
		agentDir: temp,
		promptPaths: manifest.pi.prompts,
		includeDefaults: false,
	});
	assert.deepEqual(promptDiagnostics, []);
	assert.deepEqual(
		promptTemplates.map((template) => template.name),
		["find-improvements", "interrogate", "promote"],
	);
	assert.match(
		expandPromptTemplate("/find-improvements review findings", promptTemplates),
		/focused on: review findings[\s\S]*capability-steward/,
	);
	const promoteTemplate = promptTemplates.find((template) => template.name === "promote");
	assert(promoteTemplate);
	assert.equal(promoteTemplate.argumentHint, "[focus]");
	assert.match(promoteTemplate.description, /machine-owned project files into human-owned/);
	assert.match(expandPromptTemplate("/promote", promptTemplates), /the most recent meaningful body of work/);
	assert.match(expandPromptTemplate("/promote debugging workflow", promptTemplates), /focused on: debugging workflow/);
	assert.match(promoteTemplate.content, /AGENTS\.md/);
	assert.match(promoteTemplate.content, /change no human-owned file/i);
	assert.match(promoteTemplate.content, /\.pi\/LEARNINGS\.md/);
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
		"ralph",
	];
	const engineeringSkills = [
		"prototype",
		"diagnosing-bugs",
		"formal-verification",
		"research",
		"tdd",
		"resolving-merge-conflicts",
		"domain-modeling",
		"codebase-design",
	];
	const fundamentalSkills = ["code-review", "handbook-writing", "llm-wiki"];
	const browserSkills = ["operator-sign-off", "explain-change"];
	const processSkills = [
		"peer-consultation",
		"decision-review",
		"tiger-team",
		"handoff",
		"incident-response",
		"operating-review",
		"retrospective",
		"pre-mortem",
		"prioritization",
		"release-readiness",
		"discovery-workshop",
		"onboarding",
		"failure-exercise",
		"due-diligence",
		"experiment-cycle",
	];
	const packagedSkills = [
		...explicitWorkflowSkills,
		...engineeringSkills,
		...fundamentalSkills,
		...browserSkills,
		...processSkills,
	];
	const loadedSkills = loadSkills({
		cwd: process.cwd(),
		skillPaths: manifest.pi.skills,
		includeDefaults: false,
		agentDir: temp,
	});
	assert.deepEqual(loadedSkills.diagnostics, []);
	assert.deepEqual(loadedSkills.skills.map((skill) => skill.name).sort(), packagedSkills.toSorted());
	assert(!loadedSkills.skills.some((skill) => skill.name === "review"), "legacy review skill must be absent");
	assert(!existsSync("skills/pi-exec"), "native Pi Exec guidance must not be packaged as a prerequisite skill");
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
	const processGuidance = [
		...[...processSkills, "handbook-writing"].map((name) => `skills/${name}/SKILL.md`),
		"skills/handbook-writing/references/processes.md",
		"skills/formal-verification/SKILL.md",
	];
	for (const file of processGuidance) {
		for (const [, link] of readFileSync(file, "utf8").matchAll(/\]\(([^)]+)\)/g)) {
			if (/^(https?:|#)/.test(link)) continue;
			assert(existsSync(resolve(dirname(file), link.split("#")[0])), `${file}: missing reference ${link}`);
		}
	}
	for (const skill of packagedSkills) {
		for (const [, link] of readFileSync(`skills/${skill}/SKILL.md`, "utf8").matchAll(/\]\(([^)]+)\)/g)) {
			if (/^(https?:|#)/.test(link)) continue;
			const target = resolve(`skills/${skill}`, link.split("#")[0]);
			assert(target.startsWith(resolve("skills") + "/"), `${skill} reaches outside skills/: ${link}`);
		}
	}
	for (const skill of browserSkills) {
		const links = [...readFileSync(`skills/${skill}/SKILL.md`, "utf8").matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]);
		for (const link of links) assert(!link.startsWith("../"), `${skill} links outside its directory: ${link}`);
	}
	const askUserTool = result.extensions
		.flatMap((extension) => [...extension.tools.values()])
		.find((tool) => tool.definition.name === "ask_user_question");
	assert(askUserTool, "missing ask_user_question tool definition");
	assert(!existsSync("skills/review"), "legacy review skill directory must be absent");
	assert(existsSync("skills/ralph/references/ralph.js"), "missing Ralph program");
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
