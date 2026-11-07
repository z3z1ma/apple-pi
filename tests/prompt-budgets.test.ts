import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai";
import { afterAll, expect, test, vi } from "vitest";
import { createBtwConversation } from "../components/btw/src/session.js";
import { buildInternCliArgs } from "../components/interns/src/runner.js";
import { query, startRuntime, stopRuntime, tempStateDir } from "../components/session-state/tests/helpers.js";
import { budget } from "./helpers/build-budgets.js";
import { promptSession, promptSize, toolboxGaps } from "./helpers/prompt-budget.js";

const ROOT = join(import.meta.dirname, "..");
const state = tempStateDir();
const cwd = join(state.agentDir, "project");
mkdirSync(join(cwd, ".wiki"), { recursive: true });
vi.stubEnv("PAIR_NO_REVIEW", "1");
vi.stubEnv("PI_NOTIFY_DISABLED", "1");
vi.stubEnv("RTK_ENABLED", "0");
vi.stubEnv("PI_PROGRAM_ID", "");
vi.stubEnv("PI_PROGRAM_PARENT", "");

const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

afterAll(async () => {
	await stopRuntime(state);
	vi.unstubAllEnvs();
});

test("the full package root request stays within its estimated-size guardrail", async () => {
	await startRuntime(state.socketPath);
	const run = await promptSession({
		cwd,
		agentDir: state.agentDir,
		extensions: manifest.pi.extensions.map((path: string) => join(ROOT, path)),
		skills: manifest.pi.skills.map((path: string) => join(ROOT, path)),
		tui: true,
		nativeTools: true,
	});
	try {
		await vi.waitFor(
			() =>
				expect(
					query(state.dbPath, "select id from sessions where id = ?", run.session.sessionManager.getSessionId()),
				).toHaveLength(1),
			{ timeout: 10000 },
		);
		await run.prompt();
		const measured = promptSize(run.session);
		expect(measured.tools).toEqual(
			expect.arrayContaining(["hire", "directory", "ask_user_question", "codemode", "tool_search"]),
		);
		expect(toolboxGaps(run.session)).toEqual({ untaught: [], absent: [] });
		const declared = getCurrentTools(run.request.messages);
		expect(measured.schemaChars).toBe(
			JSON.stringify(
				declared
					.map(({ name, description, parameters }) => ({ name, description, parameters }))
					.sort((left, right) => left.name.localeCompare(right.name)),
			).length,
		);
		const prompt = getCurrentSystemPrompt(run.request.messages);
		expect(measured.promptChars).toBe(prompt.length);
		expect(prompt).toContain("**The ledger**");
		expect(prompt).toContain("<pair-protocol>");
		expect(prompt).toContain(join(ROOT, "skills/code-review/SKILL.md"));
		budget("root prompt estimated tokens", measured.tokens, 37500, measured);
	} finally {
		await run.close();
	}
}, 60000);

for (const kind of ["explore", "research"] as const) {
	test(`${kind} intern prompt and active schemas stay within their token budget`, async () => {
		const args = buildInternCliArgs(kind, "Inspect this fixture.", {
			projectTrusted: true,
			model: "fixture/model",
			thinking: "off",
		});
		const extensions = args.flatMap((arg, i) => (arg === "--extension" ? [args[i + 1]!] : []));
		const run = await promptSession({
			cwd,
			agentDir: state.agentDir,
			extensions,
			tools: args[args.indexOf("--tools") + 1]!.split(","),
			append: args[args.indexOf("--append-system-prompt") + 1],
			flags: args.includes("--intern") ? { intern: true } : {},
		});
		try {
			await run.prompt();
			const measured = promptSize(run.session);
			expect(measured.tools).toEqual(expect.arrayContaining(["read", "bash", "context_lint"]));
			for (const tool of ["edit", "write", "codemode", "tool_search"])
				expect(measured.tools, `${kind} lacks ${tool}`).not.toContain(tool);
			expect(toolboxGaps(run.session)).toEqual({ untaught: [], absent: [] });
			const prompt = getCurrentSystemPrompt(run.session.messages.filter((message) => message.role === "system"));
			expect(prompt).toContain("**The ledger**");
			expect(prompt).toContain("**The wiki**");
			budget(`${kind} intern prompt estimated tokens`, measured.tokens, kind === "explore" ? 2062 : 2074, measured);
		} finally {
			await run.close();
		}
	}, 30000);
}

test("BTW's production loader stays within its prompt and schema token budget", async () => {
	const parent = await promptSession({
		cwd,
		agentDir: state.agentDir,
		extensions: [],
		tools: ["codemode", "tool_search"],
		nativeTools: true,
	});
	try {
		const context = await parent.prompt();
		expect(parent.session.getActiveToolNames()).toEqual(expect.arrayContaining(["codemode", "tool_search"]));
		const conversation = await createBtwConversation(context);
		try {
			expect(await conversation.submit("Measure this fixture.")).toBe(true);
			await vi.waitFor(() => expect(conversation.status).toBe("completed"));
			const measured = promptSize(conversation.session);
			expect(measured.tools).toEqual(["find", "grep", "ls", "read"]);
			expect(toolboxGaps(conversation.session)).toEqual({ untaught: [], absent: [] });
			budget("BTW prompt estimated tokens", measured.tokens, 830, measured);
		} finally {
			await conversation.close();
		}
	} finally {
		await parent.close();
	}
}, 30000);
