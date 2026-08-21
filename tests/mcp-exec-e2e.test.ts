import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import {
	createAgentSession,
	DefaultResourceLoader,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { fauxModelBackend } from "./helpers/faux-model.js";

const directories: string[] = [];
const providers: Array<{ unregister(): void }> = [];
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;

afterEach(() => {
	for (const provider of providers.splice(0)) provider.unregister();
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
	if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
});

describe("MCP through pi_exec", () => {
	it("discovers and calls an MCP server through the captured mcp gateway", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "apple-pi-mcp-exec-"));
		directories.push(cwd);
		process.env.PI_CODING_AGENT_DIR = join(cwd, "agent");
		writeFileSync(
			join(cwd, ".mcp.json"),
			JSON.stringify({
				mcpServers: {
					test: {
						command: process.execPath,
						args: [join(process.cwd(), "tests", "fixtures", "mcp-echo-server.mjs")],
					},
				},
			}),
		);

		const faux = registerFauxProvider({ provider: "faux", models: [{ id: "mcp-exec", contextWindow: 200_000 }] });
		providers.push(faux);
		const model = faux.getModel();
		const backend = fauxModelBackend(model);
		const loader = new DefaultResourceLoader({
			cwd,
			agentDir: process.env.PI_CODING_AGENT_DIR,
			additionalExtensionPaths: [
				join(process.cwd(), "extensions", "runtime.ts"),
				join(process.cwd(), "extensions", "mcp.ts"),
			],
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
			systemPromptOverride: () => "test",
			appendSystemPromptOverride: () => [],
		});
		await loader.reload();
		const { session } = await createAgentSession({
			cwd,
			agentDir: process.env.PI_CODING_AGENT_DIR,
			model,
			modelRegistry: backend.modelRegistry as never,
			modelRuntime: backend.modelRuntime as never,
			resourceLoader: loader,
			sessionManager: SessionManager.inMemory(cwd),
			settingsManager: SettingsManager.inMemory({ retry: { enabled: false } }),
		});
		await session.bindExtensions({});

		expect(session.getAllTools().map((tool) => tool.name)).toEqual(expect.arrayContaining(["pi_exec", "mcp"]));
		const execInfo = session.getAllTools().find((tool) => tool.name === "pi_exec");
		const codeDescription = String(execInfo?.parameters.properties.code.description ?? "");
		expect(codeDescription).toContain("extensions.mcp({");
		expect(codeDescription).toContain("tool?");
		expect(codeDescription).toContain("search?");
		session.setActiveToolsByName(["pi_exec"]);
		const exec = session.agent.state.tools.find((tool) => tool.name === "pi_exec");
		expect(exec).toBeDefined();
		const result = await exec!.execute(
			"mcp-exec-test",
			{
				code: `
const found = await tools.search("mcp gateway");
if (!found.some((tool) => tool.name === "mcp")) throw new Error("mcp gateway not captured");
const response = await extensions.mcp({ tool: "test_echo", args: { value: "APPLE" } });
return response.text;
`,
				deadlineMs: 30_000,
			},
			undefined,
			() => {},
		);
		const text = result.content.find((part) => part.type === "text")?.text ?? "";
		expect(text).toContain("echo:APPLE");
		expect((result.details as any).trace.operations).toEqual(
			expect.arrayContaining([expect.objectContaining({ ref: "extensions.mcp", outcome: "succeeded" })]),
		);

		session.dispose();
	}, 30_000);
});
