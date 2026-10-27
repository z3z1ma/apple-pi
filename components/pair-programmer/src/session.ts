import type { Model } from "@earendil-works/pi-ai";
import type { AgentSession, ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { bindPairRecallTools, type PrimarySessionManager } from "./recall.js";
import { SET_PAIR_ATTENTION_TOOL_NAME } from "./review-scheduler.js";

export const PAIR_AGENT_RETRIES = 1;
export const PAIR_SESSION_EXTENSION_PATHS: readonly string[] = [];

/** `createAgentSession({ tools })` is an allowlist. Custom tools omitted here never register. */
export const PAIR_SESSION_TOOLS = [
	"share_note",
	"ask_for_second_opinion",
	"directory",
	"expand_receipt",
	"revisit_note",
	SET_PAIR_ATTENTION_TOOL_NAME,
] as const;

export function createPairSettingsManager(
	cwd: string,
	agentDir = getAgentDir(),
	projectTrusted = false,
): SettingsManager {
	const inherited = SettingsManager.create(cwd, agentDir, { projectTrusted });
	const providerTimeoutMs = inherited.getProviderRetrySettings().timeoutMs;
	const websocketConnectTimeoutMs = inherited.getWebSocketConnectTimeoutMs();
	return SettingsManager.inMemory({
		compaction: inherited.getSettings().compaction,
		httpIdleTimeoutMs: inherited.getHttpIdleTimeoutMs(),
		...(websocketConnectTimeoutMs !== undefined ? { websocketConnectTimeoutMs } : {}),
		retry: {
			enabled: true,
			maxRetries: PAIR_AGENT_RETRIES,
			baseDelayMs: 1_000,
			provider: {
				...(providerTimeoutMs !== undefined ? { timeoutMs: providerTimeoutMs } : {}),
				maxRetries: 0,
				maxRetryDelayMs: 1_000,
			},
		},
	});
}

export async function createPairSession(opts: {
	cwd: string;
	projectTrusted?: boolean;
	model: Model<any>;
	thinkingLevel?: string;
	systemPrompt: string;
	adviseTool: ToolDefinition;
	secondOpinionTool: ToolDefinition;
	directoryTool: ToolDefinition;
	receiptTool: ToolDefinition;
	attentionTool: ToolDefinition;
	notebookTool?: ToolDefinition;
	primarySessionManager: PrimarySessionManager;
	modelRuntime?: unknown;
}): Promise<AgentSession> {
	const agentDir = getAgentDir();
	const settingsManager = createPairSettingsManager(opts.cwd, agentDir, opts.projectTrusted);
	const loader = new DefaultResourceLoader({
		cwd: opts.cwd,
		agentDir,
		settingsManager,
		noExtensions: true,
		additionalExtensionPaths: [...PAIR_SESSION_EXTENSION_PATHS],
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		systemPrompt: opts.systemPrompt,
		appendSystemPrompt: [],
	});
	await loader.reload();

	const recallTools = bindPairRecallTools(opts.primarySessionManager);
	const toolNames: string[] = [...PAIR_SESSION_TOOLS, ...(opts.notebookTool ? ["update_notebook"] : [])];
	const customTools = [
		opts.adviseTool,
		opts.secondOpinionTool,
		opts.directoryTool,
		opts.receiptTool,
		opts.attentionTool,
		...(opts.notebookTool ? [opts.notebookTool] : []),
		...recallTools,
	];
	const { session } = await createAgentSession({
		cwd: opts.cwd,
		agentDir,
		model: opts.model,
		thinkingLevel: opts.thinkingLevel as never,
		tools: toolNames,
		customTools,
		resourceLoader: loader,
		sessionManager: SessionManager.inMemory(opts.cwd),
		settingsManager,
		...(opts.modelRuntime !== undefined && { modelRuntime: opts.modelRuntime as never }),
	});
	await session.bindExtensions({});
	session.setActiveToolsByName(toolNames);
	return session;
}
