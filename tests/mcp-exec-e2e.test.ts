import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from "@earendil-works/pi-ai/compat";
import {
	createAgentSession,
	createCodemodeExtension,
	createMcpExtension,
	createToolSearchExtension,
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

describe("native MCP through Python pi_exec", () => {
	it.each(["direct", "codemode", "codemode-deferred", "deferred"])(
		"calls native MCP with %s exposure without the adapter",
		async (exposure) => {
			const cwd = mkdtempSync(join(tmpdir(), "apple-pi-mcp-exec-"));
			directories.push(cwd);
			process.env.PI_CODING_AGENT_DIR = join(cwd, "agent");
			mkdirSync(join(cwd, ".pi"));
			writeFileSync(
				join(cwd, ".pi", "mcp.json"),
				JSON.stringify({
					mcpServers: {
						test: {
							command: process.execPath,
							args: [join(process.cwd(), "tests", "fixtures", "mcp-echo-server.mjs")],
							exposure,
						},
					},
				}),
			);

			const faux = registerFauxProvider({ provider: "faux", models: [{ id: "mcp-exec", contextWindow: 200_000 }] });
			providers.push(faux);
			const model = faux.getModel();
			const backend = fauxModelBackend(model);
			const settingsManager = SettingsManager.inMemory({ retry: { enabled: false } });
			settingsManager.setProjectTrusted(true);
			const loader = new DefaultResourceLoader({
				cwd,
				agentDir: process.env.PI_CODING_AGENT_DIR,
				settingsManager,
				noExtensions: true,
				extensionFactories: [
					{ name: "mcp", builtin: true, replaceable: true, factory: createMcpExtension() },
					{ name: "codemode", builtin: true, replaceable: true, factory: createCodemodeExtension() },
					{ name: "tool-search", builtin: true, replaceable: true, factory: createToolSearchExtension() },
					{
						name: "deny-policy",
						factory: (pi) => {
							pi.on("tool_call", (event) =>
								(event.input as { value?: unknown }).value === "DENY"
									? { block: true, reason: "denied by policy" }
									: undefined,
							);
						},
					},
				],
				additionalExtensionPaths: [
					join(process.cwd(), "extensions", "pi-exec.ts"),
					"builtin:mcp",
					"builtin:codemode",
					"builtin:tool-search",
				],
				noSkills: true,
				noPromptTemplates: true,
				noThemes: true,
				noContextFiles: true,
				systemPromptOverride: () => "test",
				appendSystemPromptOverride: () => [],
			});
			await loader.reload();
			expect(loader.getExtensions().errors).toEqual([]);
			expect(loader.getExtensions().extensions.some((extension) => extension.path === "builtin:mcp")).toBe(true);
			const { session } = await createAgentSession({
				cwd,
				agentDir: process.env.PI_CODING_AGENT_DIR,
				model,
				modelRuntime: backend.modelRuntime as never,
				resourceLoader: loader,
				sessionManager: SessionManager.inMemory(cwd),
				settingsManager,
			});
			try {
				await session.bindExtensions({});
				await expect.poll(() => session.getAllTools().some((tool) => tool.name === "mcp__test__echo")).toBe(true);
				const nativeTool = session.getAllTools().find((tool) => tool.name === "mcp__test__echo");
				expect(nativeTool?.sourceInfo?.path).toBe("builtin:mcp");
				// Pi registers both indirect MCP exposures as deferred tools; they differ only in which reaching tool it activates.
				expect(nativeTool?.exposure).toBe(exposure === "direct" ? "direct" : "deferred");
				expect(session.getAllTools().map((tool) => tool.name)).not.toContain("mcp");
				if (exposure === "codemode" || exposure === "codemode-deferred")
					expect(session.getActiveToolNames()).toContain("codemode");
				if (exposure === "deferred") expect(session.getActiveToolNames()).toContain("tool_search");

				expect(session.getActiveToolNames()).toContain("pi_exec");
				// MCP waits for every server before a program runs.
				expect(
					session
						.getAllTools()
						.find((tool) => tool.name === "pi_exec")
						?.reachesTools?.({}),
				).toBe("all");
				const exec = session.agent.state.tools.find((tool) => tool.name === "pi_exec");
				const codeDescription = String((exec?.parameters as any)?.properties.code.description ?? "");
				expect(codeDescription).toContain("tools_search(query)");
				expect(codeDescription).not.toContain("mcp__test__echo");

				// A real turn: pi_exec reaches the MCP tool through Pi's nested tool pipeline.
				faux.setResponses([
					fauxAssistantMessage(
						fauxToolCall(
							"pi_exec",
							{ code: 'response = await mcp__test__echo(value="APPLE")\nresponse["text"]' },
							{ id: "mcp-python" },
						),
						{ stopReason: "toolUse" },
					),
					fauxAssistantMessage(
						fauxToolCall(
							"pi_exec",
							{
								code: 'try:\n    await mcp__test__echo(value="DENY")\n    outcome = "allowed"\nexcept Exception as error:\n    outcome = str(error)\noutcome',
							},
							{ id: "mcp-denied" },
						),
						{ stopReason: "toolUse" },
					),
					fauxAssistantMessage("done"),
				]);
				await session.prompt("echo through python");
				const results = session.sessionManager
					.getBranch()
					.flatMap((entry) => (entry.type === "message" && entry.message.role === "toolResult" ? [entry.message] : []));
				const composed = results.find((message) => message.toolCallId === "mcp-python");
				expect(composed?.isError).toBe(false);
				expect(composed?.content.find((part) => part.type === "text")?.text).toContain("echo:APPLE");
				expect((composed?.details as any)?.trace.operations).toEqual([
					expect.objectContaining({ ref: "extensions.mcp__test__echo", outcome: "succeeded" }),
				]);
				// Session tool_call hooks govern nested calls from Python too.
				const denied = results.find((message) => message.toolCallId === "mcp-denied");
				expect(denied?.content.find((part) => part.type === "text")?.text).toContain("denied by policy");
			} finally {
				try {
					await session.abort();
					await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
				} finally {
					session.dispose();
				}
			}
		},
		30_000,
	);
});
