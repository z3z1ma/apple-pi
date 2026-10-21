import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/compat";
import { type ExtensionAPI, SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, test, vi } from "vitest";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import { installSessionRole, loadRoles, PACKAGE_ROLES_DIR, sessionRole } from "../src/index.js";

const ROLE = `---
title: Test Role
models: [faux-session-provider/faux-session-model]
thinking: low
writes: false
manages: false
---
You are the test role.
`;

/** The role extension on its own, with the flag the session-state bridge registers in production. */
const organization = (pi: ExtensionAPI) => {
	pi.registerFlag("role", { type: "string", description: "role" });
	installSessionRole(pi);
};

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
	writeFileSync(join(cwd, ".pi", "roles", "broken.md"), "---\ntitle: Broken\nmodels: []\n---\nbody\n");
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
		expect(run.session.getActiveToolNames()).toEqual(["read"]);
		expect(run.session.agent.state.systemPrompt).toContain("<role>\nYou are a Staff Software Engineer");
		expect(run.customMessages("organization-role")).toHaveLength(0);
		expect(run.session.sessionManager.getEntries().filter((e) => e.type === "custom")).toMatchObject([
			{ customType: "organization-role", data: { role: "staff-engineer-simplicity" } },
		]);

		// A later start with another role keeps the stored one and records nothing new.
		await restartWithRole(run, "implementation-engineer");
		await run.session.prompt("again");
		expect(run.session.getActiveToolNames()).toEqual(["read"]);
		expect(run.session.sessionManager.getEntries().filter((e) => e.type === "custom")).toHaveLength(1);
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
		expect(run.session.getActiveToolNames().sort()).toEqual(["edit", "read", "write"]);
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
		const find = vi
			.spyOn(registryOf(run), "find")
			.mockImplementation((...args: unknown[]) =>
				args[0] === "here" ? ({ ...faux, provider: args[0], id: args[1] } as Model<string>) : undefined,
			);
		await restartWithRole(run, "picky");
		expect(find.mock.calls).toEqual([
			["gone", "first"],
			["here", "second"],
		]);
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
		expect(run.session.getActiveToolNames().sort()).toEqual(["edit", "read"]);
		expect(run.session.agent.state.systemPrompt).not.toContain("<role>");
		expect(stderr.mock.calls.map((call) => String(call[0]))).toContainEqual(
			expect.stringContaining('Unknown role "court-jester"; known roles: coordinator'),
		);
		expect(run.session.sessionManager.getEntries().filter((e) => e.type === "custom")).toHaveLength(0);
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
		expect(sessionRole({ sessionManager: resumed.session.sessionManager } as never)?.name).toBe(
			"staff-engineer-simplicity",
		);
		expect(resumed.session.getActiveToolNames()).toEqual(["read"]);
		expect(resumed.session.agent.state.systemPrompt).toContain("<role>\nYou are a Staff Software Engineer");
	} finally {
		resumed.dispose();
	}
});
