import {
	type AgentSession,
	createAgentSession,
	DefaultResourceLoader,
	type ExtensionContext,
	getAgentDir,
	type ModelRuntime,
	type NormalizedBuildSystemPromptOptions,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { AUTO_COMPACT_EXTENSION_PATH } from "../../../extensions/auto-compact.js";
import { HOME_SEARCH_GUARD_EXTENSION_PATH } from "../../../extensions/home-search-guard.js";
import { VROOM_EXTENSION_PATH } from "../../../extensions/vroom.js";
import { setSystemPromptSection } from "../../shared/src/system-prompt-section.js";
import { createTurnObserver } from "../../shared/src/turn-observer.js";

export const BTW_EXTENSION_PATHS = [
	AUTO_COMPACT_EXTENSION_PATH,
	VROOM_EXTENSION_PATH,
	HOME_SEARCH_GUARD_EXTENSION_PATH,
];
const PROMPT = `You are a concise side-channel assistant for a coding session.
Answer the user's questions directly. Use the read-only repository tools when local facts are needed, and keep files unchanged.
Questions may include a conversation-only snapshot captured when the BTW overlay opened. Use that snapshot as background for the question. The operator decides what to carry back to the main session.`;

function toolGuidance(options: NormalizedBuildSystemPromptOptions): void {
	const declared = options.selectedTools.filter((name) => !options.hiddenTools.includes(name));
	const tools = declared
		.filter((name) => options.toolSnippets[name])
		.map((name) => `- ${name}: ${options.toolSnippets[name]}`);
	const rules = new Set(
		[...declared.flatMap((name) => options.toolGuidelines[name] ?? []), ...options.promptGuidelines]
			.map((rule) => rule.trim())
			.filter(Boolean),
	);
	if (tools.length) setSystemPromptSection(options, "tools", tools.join("\n"));
	if (rules.size) setSystemPromptSection(options, "rules", [...rules].map((rule) => `- ${rule}`).join("\n"));
}

export class BtwConversation {
	status: "running" | "completed" | "error" | "aborted" = "completed";
	startedAt = Date.now();
	completedAt?: number;
	error?: string;
	activity = "thinking";
	private run: Promise<void> | undefined;
	private accepted: Promise<boolean> | undefined;
	private closing: Promise<void> | undefined;
	private stopped = false;
	private listeners = new Set<() => void>();

	constructor(readonly session: AgentSession) {}

	get toolUses() {
		return this.session.getSessionStats().toolCalls;
	}
	get lifetimeUsage(): { input: number; output: number; cacheWrite: number } {
		return this.session.getSessionStats().tokens;
	}
	get compactionCount() {
		return this.session.sessionManager.getBranch().filter((entry) => entry.type === "compaction").length;
	}
	get invocation() {
		const model = this.session.model;
		return { modelName: model ? `${model.provider}/${model.id}` : undefined, thinking: this.session.thinkingLevel };
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		const unsubscribe = this.session.subscribe(listener);
		return () => {
			unsubscribe();
			this.listeners.delete(listener);
		};
	}

	private changed(): void {
		for (const listener of this.listeners) listener();
	}

	async submit(prompt: string): Promise<boolean> {
		if (this.closing || (this.stopped && this.status === "running")) return false;
		if (this.status === "running") return (await this.session.steer(prompt)) === "queued";
		this.status = "running";
		this.startedAt = Date.now();
		this.completedAt = undefined;
		this.error = undefined;
		this.stopped = false;
		this.activity = "thinking";
		this.changed();
		const observer = createTurnObserver(this.session.sessionManager.getCwd(), (progress) => {
			this.activity = progress.activity;
		});
		let accept!: (value: boolean) => void;
		this.accepted = new Promise((resolve) => {
			accept = resolve;
		});
		const unsubscribe = this.session.subscribe((event) => {
			observer.observe(event);
			if (event.type === "agent_start") accept(true);
		});
		const finish = (error?: string) => {
			accept(false);
			const result = observer.finish({ aborted: this.stopped, error });
			this.status = this.stopped ? "aborted" : result.error ? "error" : "completed";
			this.error = result.error;
			this.completedAt = Date.now();
			this.changed();
		};
		this.run = this.session
			.prompt(prompt, { expandPromptTemplates: false })
			.then(
				() => finish(),
				(error) => finish(error instanceof Error ? error.message : String(error)),
			)
			.finally(unsubscribe);
		return this.accepted;
	}

	async stop(): Promise<void> {
		this.stopped = true;
		await this.session.abort();
		await this.accepted;
		await this.session.abort();
		await this.run;
	}

	close(): Promise<void> {
		this.closing ??= (async () => {
			try {
				await this.stop();
			} finally {
				try {
					await this.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
				} finally {
					this.listeners.clear();
					this.session.dispose();
				}
			}
		})();
		return this.closing;
	}
}

export type BtwViewState = Pick<
	BtwConversation,
	| "status"
	| "startedAt"
	| "completedAt"
	| "error"
	| "activity"
	| "toolUses"
	| "lifetimeUsage"
	| "compactionCount"
	| "invocation"
	| "subscribe"
>;

export async function createBtwConversation(ctx: ExtensionContext): Promise<BtwConversation> {
	const { model, thinkingLevel, cwd, modelRegistry } = ctx;
	if (!model) throw new Error("Select a model before starting BTW.");
	const modelRuntime = (modelRegistry as unknown as { runtime: ModelRuntime }).runtime;
	if (!modelRuntime) throw new Error("BTW cannot access the current session's model runtime.");
	const agentDir = getAgentDir();
	const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: ctx.isProjectTrusted() });
	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager,
		noExtensions: true,
		additionalExtensionPaths: BTW_EXTENSION_PATHS,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		systemPromptOverride: () => PROMPT,
		appendSystemPromptOverride: () => [],
		extensionFactories: [
			(pi) => {
				pi.on("before_agent_start", (event) => toolGuidance(event.systemPromptOptions));
			},
		],
	});
	await resourceLoader.reload();
	const errors = resourceLoader.getExtensions().errors;
	if (errors.length) throw new Error(errors.map((error) => `${error.path}: ${error.error}`).join("\n"));
	const { session } = await createAgentSession({
		cwd,
		agentDir,
		modelRuntime,
		model,
		thinkingLevel,
		settingsManager,
		resourceLoader,
		sessionManager: SessionManager.inMemory(cwd),
		tools: ["read", "grep", "find", "ls"],
	});
	const conversation = new BtwConversation(session);
	try {
		session.setSessionName("BTW");
		await session.bindExtensions({
			onError: (error) => {
				conversation.error = error.error;
			},
		});
		return conversation;
	} catch (error) {
		await conversation.close();
		throw error;
	}
}
