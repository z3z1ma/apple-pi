import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/compat";
import { type ExtensionAPI, SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, test, vi } from "vitest";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import piExec from "../../pi-exec/src/index.js";
import { modelProfilesPath } from "../../shared/src/model-profiles.js";
import * as reportingState from "../src/directory.js";
import { installOrganization, loadRoles, PACKAGE_ROLES_DIR } from "../src/index.js";
import { readRole } from "../src/roles.js";
import { ROLE_ENTRY } from "../src/session-role.js";

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
	rmSync(modelProfilesPath(), { force: true });
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
		expect(role.body.trim()).not.toBe("");
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

test("a role that used the default retains that mind when a profile is later configured", async () => {
	const cwd = tempDir();
	mkdirSync(join(cwd, ".pi", "roles"), { recursive: true });
	writeFileSync(
		join(cwd, ".pi", "roles", "lost.md"),
		ROLE.replace("models: [faux-session-provider/faux-session-model]", "models: [balanced, gone/first]"),
	);
	const run = await fauxSession([organization], [fauxAssistantMessage("ok")], ["read"], { cwd });
	const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
	try {
		const initial = run.session.model!;
		const effectiveThinking = run.session.thinkingLevel;
		vi.spyOn(registryOf(run), "find").mockImplementation((provider, id) =>
			provider === initial.provider && id === initial.id ? initial : undefined,
		);
		await restartWithRole(run, "lost");
		writeFileSync(
			modelProfilesPath(),
			JSON.stringify({
				profiles: {
					balanced: { model: "new/policy", thinking: "high" },
				},
			}),
		);
		await restartWithRole(run, "lost");
		await run.session.prompt("keep working");
		expect(run.session.model).toMatchObject({ provider: initial.provider, id: initial.id });
		expect(run.session.thinkingLevel).toBe(effectiveThinking);
		expect(run.session.agent.state.messages.at(-1)).toMatchObject({ role: "assistant", stopReason: "stop" });
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
			const prompt = run.session.agent.state.systemPrompt;
			expect(prompt.includes("own-context handoff precedes permanent deletion")).toBe(allowed);
			expect(prompt.includes("The tool returns acceptance")).toBe(allowed);
			expect(prompt).not.toContain("`rehire`");
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

test.each(["[coding, faux-session-provider/faux-session-model]", "[faux-session-provider/faux-session-model]"])(
	"role models accepts %s",
	(models) => {
		const path = join(tempDir(), "role.md");
		writeFileSync(path, ROLE.replace("[faux-session-provider/faux-session-model]", models));
		expect(readRole(path, "test")).toMatchObject({
			models: models.slice(1, -1).split(", "),
			thinking: "low",
		});
	},
);

test.each(["[coding]", "[unknown, here/model]", "[here/model, coding]", "[coding, balanced, here/model]"])(
	"role models rejects %s",
	(models) => {
		const path = join(tempDir(), "role.md");
		writeFileSync(path, ROLE.replace("[faux-session-provider/faux-session-model]", models));
		expect(readRole(path, "test")).toEqual(expect.stringContaining(": models"));
	},
);

function profileRole(cwd: string) {
	mkdirSync(join(cwd, ".pi", "roles"), { recursive: true });
	writeFileSync(
		join(cwd, ".pi", "roles", "profiled.md"),
		ROLE.replace("[faux-session-provider/faux-session-model]", "[coding, faux-session-provider/faux-session-model]"),
	);
}

function profileConfig(model: string, thinking = "high") {
	writeFileSync(modelProfilesPath(), JSON.stringify({ profiles: { coding: { model, thinking } } }));
}

test.each(["absent", "unmapped"])(
	"an %s profile uses the concrete recommendation and its role effort",
	async (config) => {
		const cwd = tempDir();
		profileRole(cwd);
		if (config === "unmapped") writeFileSync(modelProfilesPath(), JSON.stringify({ profiles: {} }));
		const installer = (pi: ExtensionAPI) => {
			pi.on("session_start", (_event, ctx) => {
				const model = { ...ctx.model!, reasoning: true };
				vi.spyOn(ctx.modelRegistry, "find").mockImplementation((provider, id) =>
					provider === model.provider && id === model.id ? model : undefined,
				);
			});
			organization(pi);
		};
		const run = await fauxSession([installer], [], ["read"], { cwd });
		try {
			await restartWithRole(run, "profiled");
			expect(run.session.model).toMatchObject({ provider: "faux-session-provider", id: "faux-session-model" });
			expect(run.session.thinkingLevel).toBe("low");
		} finally {
			run.dispose();
		}
	},
);

test("a profile selects once, retains its effective thinking across resume, and ignores edited configuration", async () => {
	const cwd = tempDir();
	profileRole(cwd);
	profileConfig("faux-session-provider/profile-choice");
	const installer = (pi: ExtensionAPI) => {
		pi.on("session_start", (_event, ctx) => {
			const model = { ...ctx.model!, id: "profile-choice", reasoning: true };
			vi.spyOn(ctx.modelRegistry, "find").mockImplementation((provider, id) =>
				provider === model.provider && id === model.id ? model : undefined,
			);
		});
		organization(pi);
	};
	const first = await fauxSession([installer], [], ["read"], {
		cwd,
		sessionManager: SessionManager.create(cwd, tempDir()),
	});
	await restartWithRole(first, "profiled");
	expect(first.session.model?.id).toBe("profile-choice");
	expect(first.session.thinkingLevel).toBe("high");
	await first.session.prompt("save");
	const file = first.session.sessionManager.getSessionFile()!;
	first.dispose();
	// Even malformed configuration is irrelevant once the chosen mind is retained.
	writeFileSync(modelProfilesPath(), "malformed");
	const resumed = await fauxSession([installer], [], ["read"], { cwd, sessionManager: SessionManager.open(file) });
	try {
		await resumed.session.prompt("resume");
		expect(resumed.session.model?.id).toBe("profile-choice");
		expect(resumed.session.thinkingLevel).toBe("high");
		expect(resumed.session.messages.at(-1)).toMatchObject({ role: "assistant", stopReason: "stop" });
		expect(resumed.session.agent.state.systemPrompt).toContain("You are the test role.");
	} finally {
		resumed.dispose();
	}
});

test("round-robin gives new people successive minds while a restart retains the first", async () => {
	const cwd = tempDir();
	profileRole(cwd);
	writeFileSync(
		modelProfilesPath(),
		JSON.stringify({
			profiles: {
				coding: {
					selection: "round-robin",
					models: [
						{ model: "faux-session-provider/first", thinking: "high" },
						{ model: "faux-session-provider/second", thinking: "medium" },
					],
				},
			},
		}),
	);
	const installer = (pi: ExtensionAPI) => {
		pi.on("session_start", (_event, ctx) => {
			const base = ctx.model!;
			vi.spyOn(ctx.modelRegistry, "find").mockImplementation((provider, id) =>
				provider === base.provider ? { ...base, id, reasoning: true } : undefined,
			);
		});
		organization(pi);
	};
	const first = await fauxSession([installer], [], ["read"], { cwd });
	const second = await fauxSession([installer], [], ["read"], { cwd });
	try {
		await restartWithRole(first, "profiled");
		expect(first.session.model?.id).toBe("first");
		expect(first.session.thinkingLevel).toBe("high");
		await first.session.bindExtensions({});
		expect(first.session.model?.id).toBe("first");
		await restartWithRole(second, "profiled");
		expect(second.session.model?.id).toBe("second");
		expect(second.session.thinkingLevel).toBe("medium");
	} finally {
		first.dispose();
		second.dispose();
	}
});

test("an older role entry selects once and retains its mind when policy changes", async () => {
	const cwd = tempDir();
	profileRole(cwd);
	const manager = SessionManager.inMemory(cwd);
	manager.appendCustomEntry(ROLE_ENTRY, { role: "profiled" });
	const run = await fauxSession([organization], [], ["read"], { cwd, sessionManager: manager });
	try {
		expect(run.session.model?.id).toBe("faux-session-model");
		writeFileSync(modelProfilesPath(), "malformed");
		await run.session.bindExtensions({});
		await run.session.prompt("continue with the retained mind");
		expect(run.session.model?.id).toBe("faux-session-model");
		expect(run.session.messages.at(-1)).toMatchObject({ role: "assistant", stopReason: "stop" });
	} finally {
		run.dispose();
	}
});

test.each(["malformed", "unknown", "unauthenticated", "setModel-false", "setModel-throws"])(
	"a %s configured profile visibly aborts the run rather than using recommendations",
	async (failure) => {
		const cwd = tempDir();
		profileRole(cwd);
		if (failure === "malformed") writeFileSync(modelProfilesPath(), "broken");
		else profileConfig(failure === "unknown" ? "gone/model" : "faux-session-provider/faux-session-model");
		const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		const installer = (pi: ExtensionAPI) => {
			organization(pi);
			if (failure.startsWith("setModel"))
				vi.spyOn(pi, "setModel").mockImplementation(async () => {
					if (failure === "setModel-throws") throw new Error("selection failed");
					return false;
				});
		};
		const requestSignals: (AbortSignal | undefined)[] = [];
		const run = await fauxSession(
			[installer],
			(_context, signal) => {
				requestSignals.push(signal);
				return fauxAssistantMessage("must not complete");
			},
			["read"],
			{ cwd },
		);
		try {
			if (failure === "unknown") vi.spyOn(registryOf(run), "find").mockReturnValue(undefined);
			if (failure === "unauthenticated")
				vi.spyOn(
					registryOf(run) as ReturnType<typeof registryOf> & { hasConfiguredAuth: () => boolean },
					"hasConfiguredAuth",
				).mockReturnValue(false);
			const errors: unknown[] = [];
			run.session.extensionRunner.setFlagValue("role", "profiled");
			await run.session.bindExtensions({ onError: (error) => errors.push(error) });
			await run.session.prompt("must not run");
			expect(requestSignals.every((signal) => signal?.aborted)).toBe(true);
			expect(run.session.messages.filter((message) => message.role === "assistant")).toEqual(
				expect.arrayContaining([expect.objectContaining({ stopReason: "aborted" })]),
			);
			expect(errors).not.toHaveLength(0);
			expect(stderr.mock.calls.some((call) => String(call[0]).includes("Role Test Role:"))).toBe(true);
		} finally {
			stderr.mockRestore();
			run.dispose();
		}
	},
);

test("concrete recommendations retain ordered setModel fallback", async () => {
	const cwd = tempDir();
	mkdirSync(join(cwd, ".pi", "roles"), { recursive: true });
	writeFileSync(
		join(cwd, ".pi", "roles", "concrete.md"),
		ROLE.replace(
			"[faux-session-provider/faux-session-model]",
			"[faux-session-provider/first, faux-session-provider/second]",
		),
	);
	const attempted: string[] = [];
	const installer = (pi: ExtensionAPI) => {
		const setModel = pi.setModel.bind(pi);
		vi.spyOn(pi, "setModel").mockImplementation(async (model) => {
			attempted.push(model.id);
			return model.id === "first" ? false : setModel(model);
		});
		organization(pi);
	};
	const run = await fauxSession([installer], [], ["read"], { cwd });
	try {
		const model = run.session.model!;
		vi.spyOn(registryOf(run), "find").mockImplementation((_provider, id) => ({ ...model, id }));
		await restartWithRole(run, "concrete");
		expect(attempted).toEqual(["first", "second"]);
		expect(run.session.model?.id).toBe("second");
	} finally {
		run.dispose();
	}
});

test("an unavailable retained mind blocks rather than selecting a new profile model", async () => {
	const cwd = tempDir();
	profileRole(cwd);
	const run = await fauxSession([organization], [], ["read"], { cwd });
	const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
	try {
		await restartWithRole(run, "profiled");
		profileConfig("other/replacement");
		vi.spyOn(registryOf(run), "find").mockReturnValue(undefined);
		const errors: unknown[] = [];
		await run.session.bindExtensions({ onError: (error) => errors.push(error) });
		await run.session.prompt("blocked");
		expect(errors).not.toHaveLength(0);
		expect(run.session.messages.at(-1)).toMatchObject({ role: "assistant", stopReason: "aborted" });
		expect(
			stderr.mock.calls.some((call) =>
				String(call[0]).includes("Selected role model faux-session-provider/faux-session-model is unavailable"),
			),
		).toBe(true);
	} finally {
		stderr.mockRestore();
		run.dispose();
	}
});
