import type { Model } from "@earendil-works/pi-ai";
import type {
	AgentSession,
	ExtensionAPI,
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

import { bindPrimaryRecallTools, type PrimarySessionManager } from "./recall.js";
import { ADVISOR_RESEED_ENTRY_ID, buildAdvisorSeed, type SettledAdvice } from "./seed.js";

export type AdvisorSeedSource = {
	entries(): readonly unknown[];
	rollingAdvice(): readonly SettledAdvice[];
};

/** `createAgentSession({ tools })` is an allowlist. Custom tools omitted here never register. */
export const ADVISOR_SESSION_TOOLS = ["advise", "read", "grep", "find", "memory_source", "session_search"] as const;

export function advisorCompactResult(event: SessionBeforeCompactEvent, source: AdvisorSeedSource) {
	return {
		compaction: {
			summary: buildAdvisorSeed({
				entries: source.entries(),
				rollingAdvice: source.rollingAdvice(),
			}),
			firstKeptEntryId: ADVISOR_RESEED_ENTRY_ID,
			tokensBefore: event.preparation.tokensBefore,
		},
	};
}

export async function createAdvisorSession(opts: {
	cwd: string;
	model: Model<any>;
	thinkingLevel?: string;
	systemPrompt: string;
	adviseTool: ToolDefinition;
	seedSource: AdvisorSeedSource;
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
				name: "advisor-reseed",
				hidden: true,
				factory: (pi: ExtensionAPI) => {
					pi.on("session_before_compact", (event) => advisorCompactResult(event, opts.seedSource));
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
		tools: [...ADVISOR_SESSION_TOOLS],
		customTools: [opts.adviseTool, ...bindPrimaryRecallTools(opts.primarySessionManager)],
		resourceLoader: loader,
		sessionManager: SessionManager.inMemory(opts.cwd),
		settingsManager,
		...(opts.modelRuntime !== undefined && { modelRuntime: opts.modelRuntime as never }),
	});
	await session.bindExtensions({});
	session.setActiveToolsByName([...ADVISOR_SESSION_TOOLS]);
	return session;
}
