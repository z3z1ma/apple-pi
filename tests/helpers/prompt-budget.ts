import { getCurrentSystemMessage, getCurrentSystemPrompt, type Model } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream, fauxAssistantMessage } from "@earendil-works/pi-ai/compat";
import {
	type AgentSession,
	createAgentSession,
	DefaultResourceLoader,
	type ExtensionContext,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { expect } from "vitest";
import { TOOL_GROUPS } from "../../components/system-prompt/src/toolbox.js";
import { fauxModelBackend } from "./faux-model.js";

export async function promptSession(options: {
	cwd: string;
	agentDir: string;
	extensions: string[];
	tools?: string[];
	append?: string;
	skills?: string[];
	tui?: boolean;
	flags?: Record<string, boolean | string>;
}) {
	const model = {
		id: "budget-model",
		name: "Budget fixture",
		api: "budget-api",
		provider: "budget-provider",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 100000,
		maxTokens: 1000,
	} as Model<string>;
	const { modelRuntime } = fauxModelBackend(model);
	const stream = () => {
		const events = createAssistantMessageEventStream();
		const message = fauxAssistantMessage("Budget fixture completed.");
		events.push({ type: "done", reason: "stop", message });
		events.end(message);
		return events;
	};
	let context!: ExtensionContext;
	const errors: string[] = [];
	const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false } }, { projectTrusted: true });
	const loader = new DefaultResourceLoader({
		cwd: options.cwd,
		agentDir: options.agentDir,
		settingsManager,
		noExtensions: true,
		additionalExtensionPaths: options.extensions,
		noSkills: true,
		additionalSkillPaths: options.skills ?? [],
		noContextFiles: true,
		noThemes: true,
		noPromptTemplates: true,
		appendSystemPrompt: options.append ? [options.append] : [],
		extensionFactories: [
			(pi) => {
				pi.on("before_agent_start", (_event, ctx) => {
					context = ctx;
				});
			},
		],
	});
	await loader.reload();
	for (const [name, value] of Object.entries(options.flags ?? {}))
		loader.getExtensions().runtime.flagValues.set(name, value);
	expect(loader.getExtensions().errors).toEqual([]);
	const sessionManager = SessionManager.inMemory(options.cwd);
	sessionManager.appendSessionInfo("Budget Fixture");
	const { session } = await createAgentSession({
		cwd: options.cwd,
		agentDir: options.agentDir,
		model,
		modelRuntime: { ...modelRuntime, stream, streamSimple: stream } as never,
		settingsManager,
		resourceLoader: loader,
		sessionManager,
		...(options.tools ? { tools: options.tools } : {}),
	});
	const close = async () => {
		try {
			await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		} finally {
			session.dispose();
		}
	};
	await session
		.bindExtensions({
			mode: options.tui ? "tui" : "print",
			...(options.tui
				? {
						uiContext: {
							notify() {},
							setStatus() {},
							setWidget() {},
							setFooter() {},
							setHeader() {},
							setEditorComponent() {},
							setTitle() {},
						} as never,
					}
				: {}),
			onError: (error) => errors.push(error.error),
		})
		.catch(async (error) => {
			await close();
			throw error;
		});
	return {
		session,
		async prompt() {
			await session.prompt("Measure the initial package loadout.");
			expect(errors).toEqual([]);
			return context;
		},
		close,
	};
}

export function toolboxGaps(session: AgentSession) {
	const active = session.getActiveToolNames();
	const sections = getCurrentSystemMessage(session.messages)?.sections ?? {};
	const toolbox = sections.toolbox ?? "";
	const taught = `${toolbox}\n${sections["goal-flow"] ?? ""}`;
	const grouped = TOOL_GROUPS.flatMap((group) => group.tools);
	return {
		untaught: active.filter((name) => !toolbox.includes(`\`${name}\``)),
		absent: grouped.filter((name) => taught.includes(`\`${name}\``) && !active.includes(name)),
	};
}

export function promptSize(session: AgentSession) {
	const names = session.getActiveToolNames().sort();
	const schemas = names.map((name) => {
		const tool = session.getToolDefinition(name);
		if (!tool) throw new Error(`Missing active schema: ${name}`);
		return { name: tool.name, description: tool.description, parameters: tool.parameters };
	});
	const promptChars = getCurrentSystemPrompt(session.messages.filter((message) => message.role === "system")).length;
	const schemaChars = JSON.stringify(schemas).length;
	return { tokens: Math.ceil((promptChars + schemaChars) / 4), promptChars, schemaChars, tools: names };
}
