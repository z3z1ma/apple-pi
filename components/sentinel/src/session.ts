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

import { compactWithXai, registerXaiCompactionReplayHooks } from "../../xai-context-compaction/src/index.js";
import { registerSentinelParentMemoryPacket } from "./parent-memory.js";
import { bindPrimaryRecallTools, type PrimarySessionManager } from "./recall.js";
import { SENTINEL_RESEED_ENTRY_ID, buildSentinelSeed, type SettledAdvice } from "./seed.js";

export type SentinelSeedSource = {
	entries(): readonly unknown[];
	rollingAdvice(): readonly SettledAdvice[];
};

/** `createAgentSession({ tools })` is an allowlist. Custom tools omitted here never register. */
export const SENTINEL_SESSION_TOOLS = [
	"advise",
	"escalate",
	"read",
	"grep",
	"find",
	"memory_source",
	"session_search",
] as const;

export async function sentinelCompactResult(
	event: SessionBeforeCompactEvent,
	source: SentinelSeedSource,
	ctx?: ExtensionContext,
) {
	const xai = ctx ? await compactWithXai(event, ctx) : undefined;
	const xaiItem = xai?.compaction?.details?.xaiCompaction;
	return {
		compaction: {
			summary: buildSentinelSeed({
				entries: source.entries(),
				rollingAdvice: source.rollingAdvice(),
				includeFold: false,
			}),
			firstKeptEntryId: SENTINEL_RESEED_ENTRY_ID,
			tokensBefore: event.preparation.tokensBefore,
			...(xaiItem ? { details: { xaiCompaction: xaiItem } } : {}),
		},
	};
}

export async function createSentinelSession(opts: {
	cwd: string;
	model: Model<any>;
	thinkingLevel?: string;
	systemPrompt: string;
	adviseTool: ToolDefinition;
	escalateTool: ToolDefinition;
	seedSource: SentinelSeedSource;
	primarySessionManager: PrimarySessionManager;
	modelRuntime?: unknown;
}): Promise<AgentSession> {
	const agentDir = getAgentDir();
	const settingsManager = SettingsManager.inMemory({
		compaction: { enabled: true, reserveTokens: 16_384, keepRecentTokens: 20_000 },
	});
	const loader = new DefaultResourceLoader({
		cwd: opts.cwd,
		agentDir,
		settingsManager,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		systemPrompt: opts.systemPrompt,
		appendSystemPrompt: [],
		extensionFactories: [
			{
				name: "sentinel-reseed",
				hidden: true,
				factory: (pi: ExtensionAPI) => {
					// Replay + reseed only. Never register the observational-memory
					// Runtime, triggers, commands, or memory_source here — those stay
					// on the primary session. The parent packet is a read of that
					// ledger, not a second OM pipeline.
					registerXaiCompactionReplayHooks(pi);
					pi.on("session_before_compact", (event, ctx) => sentinelCompactResult(event, opts.seedSource, ctx));
					registerSentinelParentMemoryPacket(pi, opts.primarySessionManager);
				},
			},
		],
	});
	await loader.reload();

	const { session } = await createAgentSession({
		cwd: opts.cwd,
		agentDir,
		model: opts.model,
		thinkingLevel: opts.thinkingLevel as never,
		tools: [...SENTINEL_SESSION_TOOLS],
		customTools: [opts.adviseTool, opts.escalateTool, ...bindPrimaryRecallTools(opts.primarySessionManager)],
		resourceLoader: loader,
		sessionManager: SessionManager.inMemory(opts.cwd),
		settingsManager,
		...(opts.modelRuntime !== undefined && { modelRuntime: opts.modelRuntime as never }),
	});
	await session.bindExtensions({});
	session.setActiveToolsByName([...SENTINEL_SESSION_TOOLS]);
	return session;
}
