import type { Model } from "@earendil-works/pi-ai";
import type {
	AgentSession,
	ExtensionAPI,
	ExtensionContext,
	SessionBeforeCompactEvent,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

import { HOME_SEARCH_GUARD_EXTENSION_PATH } from "../../../extensions/home-search-guard.js";
import { compactWithXai, registerXaiCompactionReplayHooks } from "../../xai-context-compaction/src/index.js";
import { registerPairParentNotebookPacket } from "./parent-notebook.js";
import { bindPrimaryRecallTools, type PrimarySessionManager } from "./recall.js";
import { buildPairSeed, PAIR_RESEED_ENTRY_ID, type SettledAdvice } from "./seed.js";

export const PAIR_AGENT_RETRIES = 1;
export const PAIR_SESSION_EXTENSION_PATHS = [HOME_SEARCH_GUARD_EXTENSION_PATH] as const;

export type PairSeedSource = {
	entries(): readonly unknown[];
	rollingAdvice(): readonly SettledAdvice[];
	unresolvedNotebook?(): string;
};

/** `createAgentSession({ tools })` is an allowlist. Custom tools omitted here never register. */
export const PAIR_SESSION_TOOLS = [
	"share_note",
	"ask_consultant",
	"read",
	"grep",
	"find",
	"revisit_note",
	"search_session",
] as const;

export async function pairCompactResult(
	event: SessionBeforeCompactEvent,
	source: PairSeedSource,
	ctx?: ExtensionContext,
) {
	const xai = ctx ? await compactWithXai(event, ctx) : undefined;
	const xaiItem = xai?.compaction?.details?.xaiCompaction;
	return {
		compaction: {
			summary: buildPairSeed({
				entries: source.entries(),
				rollingAdvice: source.rollingAdvice(),
				unresolvedNotebook: source.unresolvedNotebook?.(),
				includeFold: false,
			}),
			firstKeptEntryId: PAIR_RESEED_ENTRY_ID,
			tokensBefore: event.preparation.tokensBefore,
			...(xaiItem ? { details: { xaiCompaction: xaiItem } } : {}),
		},
	};
}

export function createPairSettingsManager(
	cwd: string,
	agentDir = getAgentDir(),
	projectTrusted = false,
): SettingsManager {
	const inherited = SettingsManager.create(cwd, agentDir, { projectTrusted });
	const providerTimeoutMs = inherited.getProviderRetrySettings().timeoutMs;
	const websocketConnectTimeoutMs = inherited.getWebSocketConnectTimeoutMs();
	return SettingsManager.inMemory({
		compaction: { enabled: true, reserveTokens: 16_384, keepRecentTokens: 20_000 },
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
	escalateTool: ToolDefinition;
	notebookTool?: ToolDefinition;
	seedSource: PairSeedSource;
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
		extensionFactories: [
			{
				name: "pair-reseed",
				hidden: true,
				factory: (pi: ExtensionAPI) => {
					// Replay + reseed only. Never register the pair programmer notebook
					// Runtime, triggers, commands, or revisit_note here — those stay
					// on the primary session. The parent packet is a read of that
					// ledger, not a second notebook pipeline.
					registerXaiCompactionReplayHooks(pi);
					pi.on("session_before_compact", (event, ctx) => pairCompactResult(event, opts.seedSource, ctx));
					registerPairParentNotebookPacket(pi, opts.primarySessionManager);
				},
			},
		],
	});
	await loader.reload();

	const toolNames = [...PAIR_SESSION_TOOLS, ...(opts.notebookTool ? ["update_notebook" as const] : [])];
	const customTools = [
		opts.adviseTool,
		opts.escalateTool,
		...(opts.notebookTool ? [opts.notebookTool] : []),
		...bindPrimaryRecallTools(opts.primarySessionManager),
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
