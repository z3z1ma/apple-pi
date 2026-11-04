import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getCurrentSystemMessage } from "@earendil-works/pi-ai";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { promptSession, toolboxGaps } from "../../../tests/helpers/prompt-budget.js";
import { query, startRuntime, stopRuntime, tempStateDir } from "../../session-state/tests/helpers.js";
import { composeSystemPrompt, SECTION_ORDER } from "../src/index.js";
import { OPERATING_MODEL } from "../src/preamble.js";
import { TOOL_GROUPS, toolboxSection } from "../src/toolbox.js";

const ROOT = join(import.meta.dirname, "../../..");
const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const EXTENSIONS: string[] = manifest.pi.extensions.map((path: string) => join(ROOT, path));
const SKILLS: string[] = manifest.pi.skills.map((path: string) => join(ROOT, path));
const KNOWN = TOOL_GROUPS.flatMap((group) => group.tools);
const state = tempStateDir();
const cwd = join(state.agentDir, "project");
mkdirSync(join(cwd, ".wiki"), { recursive: true });
vi.stubEnv("PAIR_NO_REVIEW", "1");
vi.stubEnv("PI_NOTIFY_DISABLED", "1");
vi.stubEnv("RTK_ENABLED", "0");

beforeAll(() => startRuntime(state.socketPath));
afterAll(async () => {
	await stopRuntime(state);
	vi.unstubAllEnvs();
});

const mentioned = (text: string) => KNOWN.filter((name) => text.includes(`\`${name}\``));

async function rootSession(flags: Record<string, string> = {}) {
	const run = await promptSession({
		cwd,
		agentDir: state.agentDir,
		extensions: EXTENSIONS,
		skills: SKILLS,
		tui: true,
		flags,
	});
	try {
		const id = run.session.sessionManager.getSessionId();
		await vi.waitFor(() => expect(query(state.dbPath, "select id from sessions where id = ?", id)).toHaveLength(1), {
			timeout: 10000,
		});
		await run.prompt();
		return {
			id,
			sections: getCurrentSystemMessage(run.session.messages)?.sections ?? {},
			active: run.session.getActiveToolNames(),
			gaps: toolboxGaps(run.session),
		};
	} finally {
		await run.close();
	}
}

test("in every posture the toolbox teaches exactly the active tools", async () => {
	const root = await rootSession();
	expect(root.gaps).toEqual({ untaught: [], absent: [] });
	expect(root.active).toEqual(expect.arrayContaining(["hire", "progress", "pi_exec"]));
	const cases = [
		{ role: "implementation-engineer", has: ["edit"], lacks: ["hire", "progress", "activity"] },
		{ role: "coordinator", has: ["hire", "progress", "activity"], lacks: [] },
		{ role: "scout", has: ["activity", "note"], lacks: ["hire", "edit"] },
	];
	for (const { role, has, lacks } of cases) {
		const person = await rootSession({ role, "reports-to": root.id });
		expect(person.gaps, role).toEqual({ untaught: [], absent: [] });
		expect(person.active, role).toEqual(expect.arrayContaining(has));
		for (const tool of lacks) expect(person.active, `${role} lacks ${tool}`).not.toContain(tool);
	}
}, 240_000);

test("with the pair programmer off, its tool and its toolbox group are gone", async () => {
	writeFileSync(join(state.agentDir, ".pair-state.json"), JSON.stringify({ enabled: false }));
	try {
		const { sections, active, gaps } = await rootSession();
		expect(gaps).toEqual({ untaught: [], absent: [] });
		expect(active).not.toContain("acknowledge_pair_findings");
		expect(sections.toolbox).not.toContain("The pair programmer");
		expect(sections["pair-protocol"]).toBeUndefined();
	} finally {
		rmSync(join(state.agentDir, ".pair-state.json"), { force: true });
	}
}, 120_000);

test("a real root session gets the operating model, a toolbox that teaches every active tool, and sections ordered from stable to personal", async () => {
	{
		const { sections, active } = await rootSession();
		expect(active).toContain("acknowledge_pair_findings");
		expect(sections.preamble).toBe(OPERATING_MODEL);
		expect(sections.tools).toBeUndefined();
		expect(sections.rules).toBeUndefined();
		const toolbox = sections.toolbox ?? "";
		expect(active.filter((name) => !toolbox.includes(`\`${name}\``))).toEqual([]);
		expect(mentioned(toolbox).filter((name) => !active.includes(name))).toEqual([]);
		const names = Object.keys(sections);
		const known = names.filter((name) => SECTION_ORDER.includes(name));
		expect(known).toEqual([...known].sort((a, b) => SECTION_ORDER.indexOf(a) - SECTION_ORDER.indexOf(b)));
		for (const [earlier, later] of [
			["toolbox", "role-catalog"],
			["role-catalog", "skills"],
			["skills", "org"],
			["org", "self"],
		])
			expect(names.indexOf(earlier!), `${earlier} before ${later}`).toBeLessThan(names.indexOf(later!));
	}
}, 120_000);

test("a toolbox teaches only the tools a session has, and passes on guidance for tools it does not know", () => {
	const toolbox = toolboxSection(
		["read", "bash", "directory", "send_mail", "reply", "mcp__docs__search"],
		{ read: "Grouped snippet", mcp__docs__search: "Search the docs" },
		{ read: ["Grouped guideline"], mcp__docs__search: ["Search before reading."] },
		["Prefer small commits."],
	);
	expect(mentioned(toolbox).sort()).toEqual(["bash", "directory", "read", "reply", "send_mail"]);
	expect(toolbox).not.toContain("## The review board");
	expect(toolbox).not.toContain("When you staff and steer");
	expect(toolbox).not.toContain("Grouped snippet");
	expect(toolbox).not.toContain("Grouped guideline");
	expect(toolbox).toContain("- `mcp__docs__search`: Search the docs\n  - Search before reading.");
	expect(toolbox).toContain("- Prefer small commits.");
});

test("a prompt the user supplies stays the preamble, and the composer writes no toolbox", () => {
	const options = {
		cwd,
		customPrompt: "You are the house agent.",
		selectedTools: ["read"],
		hiddenTools: [],
		toolSnippets: { read: "Read files" },
		toolGuidelines: {},
		promptGuidelines: [],
		appendSystemPrompt: "",
		sections: { self: "Me.", "repo-rules": "Rules." },
		contextFiles: [{ path: "/repo/AGENTS.md", content: "Keep it simple." }],
		skills: [],
	};
	composeSystemPrompt(options);
	expect(options.customPrompt).toBe("You are the house agent.");
	expect(Object.keys(options.sections)).toEqual(["project_context", "repo-rules", "self"]);
});
