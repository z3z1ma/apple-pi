import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getCurrentSystemMessage } from "@earendil-works/pi-ai";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { promptSession } from "../../../tests/helpers/prompt-budget.js";
import { query, startRuntime, stopRuntime, tempStateDir } from "../../session-state/tests/helpers.js";
import { composeSystemPrompt, SECTION_ORDER } from "../src/index.js";

const ROOT = join(import.meta.dirname, "../../..");
const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const EXTENSIONS: string[] = manifest.pi.extensions.map((path: string) => join(ROOT, path));
const SKILLS: string[] = manifest.pi.skills.map((path: string) => join(ROOT, path));
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

async function sections(extensions: string[]) {
	const run = await promptSession({ cwd, agentDir: state.agentDir, extensions, skills: SKILLS, tui: true });
	try {
		const id = run.session.sessionManager.getSessionId();
		await vi.waitFor(() => expect(query(state.dbPath, "select id from sessions where id = ?", id)).toHaveLength(1), {
			timeout: 10000,
		});
		await run.prompt();
		const system = getCurrentSystemMessage(run.session.messages);
		return { sections: system?.sections ?? {}, preamble: String(system?.content ?? "") };
	} finally {
		await run.close();
	}
}

test("a real root session's composed prompt holds Pi's and every extension's sections unchanged, ordered from stable to personal", async () => {
	const withPi = await sections(EXTENSIONS.filter((path) => !path.endsWith("system-prompt.ts")));
	const composed = await sections(EXTENSIONS);
	const personal = (all: Record<string, string | null>) =>
		Object.fromEntries(Object.entries(all).filter(([name]) => name !== "org"));
	expect(personal(composed.sections)).toEqual(personal(withPi.sections));
	expect(Object.keys(composed.sections).sort()).toEqual(Object.keys(withPi.sections).sort());
	const names = Object.keys(composed.sections);
	const known = names.filter((name) => SECTION_ORDER.includes(name));
	expect(known).toEqual([...known].sort((a, b) => SECTION_ORDER.indexOf(a) - SECTION_ORDER.indexOf(b)));
	for (const [earlier, later] of [
		["tools", "role-catalog"],
		["role-catalog", "skills"],
		["skills", "ledger-workbench"],
		["ledger-workbench", "org"],
		["org", "self"],
	])
		expect(names.indexOf(earlier!), `${earlier} before ${later}`).toBeLessThan(names.indexOf(later!));
	expect(composed.sections.tools).toContain("- take_task:");
}, 120_000);

test("a prompt the user supplies stays the preamble, and Pi's generic tool sections stay out", () => {
	const options = {
		cwd,
		customPrompt: "You are the house agent.",
		selectedTools: ["read"],
		hiddenTools: [],
		toolSnippets: { read: "Read files" },
		toolGuidelines: {},
		promptGuidelines: [],
		appendSystemPrompt: "",
		sections: { self: "Me.", "ledger-workbench": "Ledger." },
		contextFiles: [{ path: "/repo/AGENTS.md", content: "Keep it simple." }],
		skills: [],
	};
	composeSystemPrompt(options);
	expect(options.customPrompt).toBe("You are the house agent.");
	expect(Object.keys(options.sections)).toEqual(["project_context", "ledger-workbench", "self"]);
	expect(options.contextFiles).toEqual([]);
});
