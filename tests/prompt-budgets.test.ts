import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { afterAll, expect, test, vi } from "vitest";
import { createBtwConversation } from "../components/btw/src/session.js";
import { buildInternCliArgs } from "../components/interns/src/runner.js";
import { query, startRuntime, stopRuntime, tempStateDir } from "../components/session-state/tests/helpers.js";
import { budget } from "./helpers/build-budgets.js";
import { promptSession, promptSize } from "./helpers/prompt-budget.js";

const ROOT = join(import.meta.dirname, "..");
const state = tempStateDir();
const cwd = join(state.agentDir, "project");
mkdirSync(join(cwd, ".wiki"), { recursive: true });
vi.stubEnv("PAIR_NO_REVIEW", "1");
vi.stubEnv("PI_NOTIFY_DISABLED", "1");
vi.stubEnv("RTK_ENABLED", "0");

const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

afterAll(async () => {
	await stopRuntime(state);
	vi.unstubAllEnvs();
});

test("the full package root prompt and active schemas stay within their token budget", async () => {
	await startRuntime(state.socketPath);
	const run = await promptSession({
		cwd,
		agentDir: state.agentDir,
		extensions: manifest.pi.extensions.map((path: string) => join(ROOT, path)),
		skills: manifest.pi.skills.map((path: string) => join(ROOT, path)),
		tui: true,
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
		expect(measured.tools).toEqual(expect.arrayContaining(["pi_exec", "hire", "directory", "ask_user_question"]));
		const prompt = getCurrentSystemPrompt(run.session.messages.filter((message) => message.role === "system"));
		expect(prompt).toContain("<ledger-workbench>");
		expect(prompt).toContain("<pair-protocol>");
		expect(run.session.resourceLoader.getSkills().skills.length).toBeGreaterThan(0);
		budget("root prompt estimated tokens", measured.tokens, 35056, measured);
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
			expect(measured.tools).not.toContain("edit");
			expect(getCurrentSystemPrompt(run.session.messages.filter((message) => message.role === "system"))).toContain(
				"<ledger-workbench>",
			);
			budget(`${kind} intern prompt estimated tokens`, measured.tokens, kind === "explore" ? 2274 : 2285, measured);
		} finally {
			await run.close();
		}
	}, 30000);
}

test("BTW's production loader stays within its prompt and schema token budget", async () => {
	const parent = await promptSession({ cwd, agentDir: state.agentDir, extensions: [], tools: [] });
	try {
		const context = await parent.prompt();
		const conversation = await createBtwConversation(context);
		try {
			expect(await conversation.submit("Measure this fixture.")).toBe(true);
			await vi.waitFor(() => expect(conversation.status).toBe("completed"));
			const measured = promptSize(conversation.session);
			expect(measured.tools).toEqual(["find", "grep", "ls", "read"]);
			budget("BTW prompt estimated tokens", measured.tokens, 844, measured);
		} finally {
			await conversation.close();
		}
	} finally {
		await parent.close();
	}
}, 30000);
