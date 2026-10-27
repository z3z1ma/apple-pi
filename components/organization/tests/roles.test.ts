import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/compat";
import { type ExtensionAPI, SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, test, vi } from "vitest";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import piExec from "../../pi-exec/src/index.js";
import * as reportingState from "../src/directory.js";
import { installOrganization, loadRoles, PACKAGE_ROLES_DIR } from "../src/index.js";

const ROLE = `---
title: Test Role
mandate: Test the role
models: [faux-session-provider/faux-session-model]
thinking: low
writes: false
manages: false
---
You are the test role.
`;

/** The organization extension on its own, with the flags the session-state bridge registers in production. */
const organization = (pi: ExtensionAPI) => {
	pi.registerFlag("role", { type: "string", description: "role" });
	pi.registerFlag("reports-to", { type: "string", description: "manager" });
	installOrganization(pi);
};

// The organization reads the session-state database; a temporary agent directory keeps tests off the operator's.
vi.stubEnv("PI_CODING_AGENT_DIR", mkdtempSync(join(tmpdir(), "apo-agent-")));

const dirs: string[] = [];
const tempDir = () => {
	const dir = mkdtempSync(join(tmpdir(), "apo-"));
	dirs.push(dir);
	return dir;
};
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The session's model registry, which `ctx.modelRegistry.find` reads; private to Pi's runner, so reached untyped. */
const registryOf = (run: Awaited<ReturnType<typeof fauxSession>>) =>
	(run.session.extensionRunner as unknown as { modelRegistry: { find: (provider: string, id: string) => unknown } })
		.modelRegistry;

/** Restart a faux session with `--role <name>`: a new session_start reads the flag. */
async function restartWithRole(run: Awaited<ReturnType<typeof fauxSession>>, role: string) {
	run.session.extensionRunner.setFlagValue("role", role);
	await run.session.bindExtensions({});
}

test("the package catalog loads, a project file overrides by name, and a bad file is named and skipped", () => {
	const cwd = tempDir();
	const packaged = loadRoles(cwd);
	expect(packaged.problems).toEqual([]);
	expect(packaged.roles.get("coordinator")).toMatchObject({ manages: true, writes: true, thinking: "high" });
	expect(packaged.roles.get("staff-engineer-simplicity")).toMatchObject({ manages: false, writes: false });
	for (const role of packaged.roles.values()) {
		expect(role.path.startsWith(PACKAGE_ROLES_DIR)).toBe(true);
		expect(role.body.length).toBeGreaterThan(200);
	}

	mkdirSync(join(cwd, ".pi", "roles"), { recursive: true });
	writeFileSync(join(cwd, ".pi", "roles", "coordinator.md"), ROLE);
	writeFileSync(join(cwd, ".pi", "roles", "broken.md"), "---\ntitle: Broken\nmandate: Break\nmodels: []\n---\nbody\n");
	const local = loadRoles(cwd);
	expect(local.roles.get("coordinator")).toMatchObject({ title: "Test Role", manages: false });
	expect(local.roles.has("broken")).toBe(false);
	expect(local.problems).toEqual([expect.stringContaining(`${join(cwd, ".pi", "roles", "broken.md")}: models`)]);
});

test("a role without writes loses edit and write, gets the role section, and keeps its role when restarted", async () => {
	const run = await fauxSession(
		[organization],
		[fauxAssistantMessage("ok"), fauxAssistantMessage("ok")],
		["read", "edit", "write"],
	);
	try {
		await restartWithRole(run, "staff-engineer-simplicity");
		await run.session.prompt("hi");
		expect(run.session.getActiveToolNames()).toEqual(["read", "update_self"]);
		expect(run.session.agent.state.systemPrompt).toContain("<role>\nYou are a Staff Software Engineer");

		// A later start with another role keeps the one the session already holds.
		await restartWithRole(run, "implementation-engineer");
		await run.session.prompt("again");
		expect(run.session.getActiveToolNames()).toEqual(["read", "update_self"]);
		expect(run.session.agent.state.systemPrompt).toContain("<role>\nYou are a Staff Software Engineer");
	} finally {
		run.dispose();
	}
});

test("a role that writes keeps edit and write; an unroled session has no role section", async () => {
	const run = await fauxSession(
		[organization],
		[fauxAssistantMessage("ok"), fauxAssistantMessage("ok")],
		["read", "edit", "write"],
	);
	try {
		await run.session.prompt("hi");
		expect(run.session.agent.state.systemPrompt).not.toContain("<role>");
		await restartWithRole(run, "implementation-engineer");
		await run.session.prompt("hi");
		expect(run.session.getActiveToolNames().sort()).toEqual(["edit", "read", "update_self", "write"]);
		expect(run.session.agent.state.systemPrompt).toContain("<role>\nYou are an Implementation Engineer");
	} finally {
		run.dispose();
	}
});

test("the first listed model the registry knows becomes the session's model", async () => {
	const cwd = tempDir();
	mkdirSync(join(cwd, ".pi", "roles"), { recursive: true });
	writeFileSync(
		join(cwd, ".pi", "roles", "picky.md"),
		ROLE.replace("models: [faux-session-provider/faux-session-model]", "models: [gone/first, here/second, here/third]"),
	);
	const run = await fauxSession([organization], [fauxAssistantMessage("ok")], ["read"], { cwd });
	try {
		const faux = run.session.model as Model<string>;
		vi.spyOn(registryOf(run), "find").mockImplementation((...args: unknown[]) =>
			args[0] === "here" ? ({ ...faux, provider: args[0], id: args[1] } as Model<string>) : undefined,
		);
		await restartWithRole(run, "picky");
		expect(run.session.model).toMatchObject({ provider: "here", id: "second" });
	} finally {
		run.dispose();
	}
});

test("a role whose models are all unknown warns once and stays on the default model", async () => {
	const cwd = tempDir();
	mkdirSync(join(cwd, ".pi", "roles"), { recursive: true });
	writeFileSync(
		join(cwd, ".pi", "roles", "lost.md"),
		ROLE.replace("models: [faux-session-provider/faux-session-model]", "models: [gone/first, gone/second]"),
	);
	const run = await fauxSession([organization], [fauxAssistantMessage("ok")], ["read"], { cwd });
	const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
	try {
		vi.spyOn(registryOf(run), "find").mockReturnValue(undefined);
		await restartWithRole(run, "lost");
		await run.session.prompt("hi");
		expect(run.session.model).toMatchObject({ id: "faux-session-model" });
		const warnings = stderr.mock.calls.map((call) => String(call[0])).filter((line) => line.includes("Role"));
		expect(warnings).toEqual([
			expect.stringContaining("Role Test Role: none of its models is available (gone/first, gone/second)"),
		]);
		expect(run.session.agent.state.systemPrompt).toContain("<role>\nYou are the test role.");
	} finally {
		stderr.mockRestore();
		run.dispose();
	}
});

test("an unknown role name warns and leaves the session unroled", async () => {
	const run = await fauxSession([organization], [fauxAssistantMessage("ok")], ["read", "edit"]);
	const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
	try {
		await restartWithRole(run, "court-jester");
		await run.session.prompt("hi");
		expect(run.session.getActiveToolNames().sort()).toEqual(["edit", "read", "update_self"]);
		expect(run.session.agent.state.systemPrompt).not.toContain("<role>");
		expect(stderr.mock.calls.map((call) => String(call[0]))).toContainEqual(
			expect.stringContaining('Unknown role "court-jester"; known roles: accessibility-specialist'),
		);
	} finally {
		stderr.mockRestore();
		run.dispose();
	}
});

test("a resumed session takes its role from its transcript, with no flag", async () => {
	const cwd = tempDir();
	const sessionDir = tempDir();
	const first = await fauxSession([organization], [fauxAssistantMessage("ok")], ["read", "edit"], {
		cwd,
		sessionManager: SessionManager.create(cwd, sessionDir),
	});
	await restartWithRole(first, "staff-engineer-simplicity");
	await first.session.prompt("hi"); // writes the session file
	const file = first.session.sessionManager.getSessionFile()!;
	first.dispose();

	const resumed = await fauxSession([organization], [fauxAssistantMessage("ok")], ["read", "edit"], {
		cwd,
		sessionManager: SessionManager.open(file),
	});
	try {
		await resumed.session.prompt("back");
		expect(resumed.session.getActiveToolNames()).toEqual(["read", "update_self"]);
		expect(resumed.session.agent.state.systemPrompt).toContain("<role>\nYou are a Staff Software Engineer");
		// The soul drawn at the first start is the one the resumed session has.
		const soulOf = (prompt: string) => prompt.match(/\*\*Article \d+\*\*/g);
		expect(soulOf(resumed.session.agent.state.systemPrompt)).toEqual(soulOf(first.session.agent.state.systemPrompt));
		expect(soulOf(resumed.session.agent.state.systemPrompt)).toHaveLength(3);
	} finally {
		resumed.dispose();
	}
});

test.each([
	{ role: undefined, parent: undefined, allowed: false },
	{ role: undefined, parent: null, allowed: true },
	{ role: undefined, parent: "boss", allowed: false },
	{ role: "implementation-engineer", parent: null, allowed: false },
	{ role: "coordinator", parent: "boss", allowed: true },
	{ role: "director-of-engineering", parent: null, allowed: true },
])(
	"peer schemas and guidance follow current capabilities (role=$role, parent=$parent)",
	async ({ role, parent, allowed }) => {
		const reporting = vi
			.spyOn(reportingState, "reportingOf")
			.mockImplementation((id) => (parent === undefined ? undefined : { id, reportsTo: parent }));
		// Production installs pi_exec before organization resolves the session's role.
		const run = await fauxSession([piExec, organization], [fauxAssistantMessage("ok")], ["pi_exec"]);
		const model = run.session.model;
		const thinking = run.session.thinkingLevel;
		try {
			const errors: unknown[] = [];
			const programs = join(run.cwd, ".pi", "programs");
			mkdirSync(programs, { recursive: true });
			writeFileSync(join(programs, "probe.py"), '"""A role schema probe."""\n1 + 2\n');
			if (role) run.session.extensionRunner.setFlagValue("role", role);
			await run.session.bindExtensions({ onError: (error) => errors.push(error) });
			run.session.setActiveToolsByName(["pi_exec", "program_probe"]);
			await run.session.prompt("ready");
			expect(errors).toEqual([]);
			const parameters = run.session.agent.state.tools.find((tool) => tool.name === "pi_exec")!.parameters as {
				properties: { code: { description: string }; peers?: unknown };
			};
			expect("peers" in parameters.properties).toBe(allowed);
			const program = run.session.agent.state.tools.find((tool) => tool.name === "program_probe")!;
			const limits = (program.parameters as { properties: { limits: { properties: object } } }).properties.limits;
			expect("agentBudget" in limits.properties).toBe(allowed);
			expect(parameters.properties.code.description.includes("async def peer(")).toBe(allowed);
			expect(parameters.properties.code.description.includes("async def agent_run(")).toBe(allowed);
			expect(run.session.agent.state.systemPrompt.includes("Attach awake colleagues")).toBe(allowed);
			if (!role && allowed) {
				const prompt = run.session.agent.state.systemPrompt;
				expect(prompt).toContain("<role-catalog>");
				expect(prompt).toContain("`org_work`");
				expect(prompt).toContain("work directly or delegate");
				expect(prompt).not.toContain("<manager>");
				expect(prompt).not.toContain("<role>");
				expect(run.session.model).toBe(model);
				expect(run.session.thinkingLevel).toBe(thinking);
			}
		} finally {
			reporting.mockRestore();
			run.dispose();
		}
	},
);

test("everyone gets the org section; only a managing role gets the manager charter", async () => {
	const reporting = vi.spyOn(reportingState, "reportingOf").mockReturnValue(undefined);
	const run = await fauxSession(
		[organization],
		[fauxAssistantMessage("ok"), fauxAssistantMessage("ok"), fauxAssistantMessage("ok")],
		["read"],
	);
	try {
		const id = run.session.sessionManager.getSessionId();
		await run.session.prompt("hi");
		let prompt = run.session.agent.state.systemPrompt;
		expect(prompt).toContain(`<org>\nYou are a session with no role, a person in an organization`);
		expect(prompt).toContain(`Your session id is \`${id}\``);
		expect(prompt).toContain("`directory` starts with organization counts");
		expect(prompt).toContain("`history: {limit, offset}`");
		expect(prompt).not.toContain("former: true");
		expect(prompt).toContain("You are the root of your organization");
		expect(prompt).not.toContain("You hold the manager tools");
		expect(prompt).toContain("`link`");
		for (const tool of ["org_waits", "org_work", "org_communication", "org_expertise", "org_fitness", "predictions"])
			expect(prompt).not.toContain(`\`${tool}\``);
		expect(prompt).not.toContain("<role-catalog>");
		expect(prompt).not.toContain("<manager>");

		run.session.extensionRunner.setFlagValue("reports-to", "old-boss");
		reporting.mockReturnValue({ id, reportsTo: "boss" });
		await restartWithRole(run, "staff-engineer-simplicity");
		await run.session.prompt("hi");
		prompt = run.session.agent.state.systemPrompt;
		expect(prompt).toContain("<org>\nYou are Staff Engineer, Simplicity, a person");
		expect(prompt).toContain("You report to the session `boss`");
		expect(prompt).toContain("ask your manager to hire one");
		expect(prompt).toContain("`link`");
		for (const tool of ["org_waits", "org_work", "org_communication", "org_expertise", "org_fitness", "predictions"])
			expect(prompt).not.toContain(`\`${tool}\``);
		expect(prompt).not.toContain("<role-catalog>");
		expect(prompt).not.toContain("<manager>");
	} finally {
		reporting.mockRestore();
		run.dispose();
	}

	const manager = await fauxSession([organization], [fauxAssistantMessage("ok")], ["read"]);
	try {
		await restartWithRole(manager, "coordinator");
		await manager.session.prompt("hi");
		const prompt = manager.session.agent.state.systemPrompt;
		expect(prompt).toContain("<org>\nYou are Coordinator, a person");
		expect(prompt).toContain("<role-catalog>");
		for (const tool of [
			"org_waits",
			"org_work",
			"org_communication",
			"org_expertise",
			"org_fitness",
			"predictions",
			"link",
		])
			expect(prompt).toContain(`\`${tool}\``);
		expect(prompt).toContain("<manager>\nYou are a manager: the operator brings you work");
		expect(prompt).toMatch(/standup[\s\S]*remind_me[\s\S]*meet/);
		for (const moment of [
			"when the operator asks",
			"during planning or implementation",
			"when reports, escalations or updates arrive",
			"when work looks constrained",
			"in sweeps",
		])
			expect(prompt).toContain(moment);
		expect(prompt).toMatch(/org_expertise[\s\S]*before assigning or hiring/);
		expect(prompt).toContain("investigate causes through tasks, links, history and mail");
		expect(prompt).toContain("ask a subordinate manager to reorganize its subtree");
		expect(prompt).toContain("keep the organization stable when change would cost more than it gives");
		expect(prompt).toMatch(/Record important reasoning[\s\S]*revisit consequential decisions/);
		expect(prompt).toContain("Fitness and scenarios are optional instruments");
		expect(prompt).toContain("not an objective to hill-climb or a forecast required before action");
		expect(prompt).toMatch(/Reporting manager, task owner and decision authority are separate roles that may coincide/);
		expect(prompt).toMatch(
			/Loosely coupled work suits parallel people; tightly coupled work suits one strong owner; risky work benefits from an independent challenger/,
		);
		expect(prompt).toMatch(
			/fan-in[\s\S]*repeatedly constrains progress[\s\S]*consider whether changing decision authority, assignments or reporting would help/,
		);
		expect(prompt).not.toContain("95th-percentile");
		expect(prompt).not.toContain("when work waits, or a person carries more");
		expect(prompt).not.toContain("would make you the bottleneck, hire a manager");
	} finally {
		manager.dispose();
	}
});
