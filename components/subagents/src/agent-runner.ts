/**
 * agent-runner.ts — Core execution engine: creates sessions, runs agents, collects results.
 */

import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
	type AgentSession,
	type AgentSessionEvent,
	createAgentSession,
	DefaultResourceLoader,
	type ExtensionAPI,
	getAgentDir,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { AUTO_COMPACT_EXTENSION_PATH } from "../../../extensions/auto-compact.js";
import { CODEX_FAST_EXTENSION_PATH } from "../../../extensions/codex-vroom.js";
import { HOME_SEARCH_GUARD_EXTENSION_PATH } from "../../../extensions/home-search-guard.js";
import { LEDGER_EXTENSION_PATH } from "../../../extensions/ledger.js";
import { MCP_EXTENSION_PATH } from "../../../extensions/mcp.js";
import { PAIR_EXTENSION_PATH } from "../../../extensions/pi-pair.js";
import { SESSION_SEARCH_EXTENSION_PATH } from "../../../extensions/session-search.js";
import { BUILTIN_TOOL_NAMES, getAgentConfig, getToolNamesForType } from "./agent-types.js";
import { runInChildSessionContext } from "./child-context.js";
import { buildFullParentContext, extractText } from "./context.js";
import { detectEnv } from "./env.js";
import { resolveAgentProfile } from "./model-routing.js";
import {
	createNestedSubagentTools,
	getMaxSubagentDepth,
	type NestedAgentManager,
	SUBAGENT_TOOL_NAMES,
} from "./nested-tools.js";
import { buildAgentPrompt, type PromptExtras } from "./prompts.js";
import type { AssistantUsageDelta, ManagedAgentToolPolicy } from "./service.js";
import { preloadSkills } from "./skill-loader.js";
import type { AgentConfig, SubagentType, ThinkingLevel } from "./types.js";

export { getAgentConversation } from "./conversation.js";

function notifyObserver<Args extends unknown[]>(observer: ((...args: Args) => void) | undefined, ...args: Args): void {
	try {
		observer?.(...args);
	} catch {
		// Activity and UI observers never own model-session control flow.
	}
}

/**
 * Tool names registered by THIS extension. Single source of truth so the
 * registration sites (index.ts) and the subagent exclusion list below can't
 * drift apart. These are our own tools, not pi built-ins, so they can't be
 * derived from pi — but they only need defining once.
 */
export { SUBAGENT_TOOL_NAMES };

/**
 * Root-session capabilities that child sessions must never inherit.
 *
 * `pi_exec` is root-only because its host bridge can launch independent model
 * workers and invoke captured root extension tools. Exposing it to a child
 * would bypass the ownership and depth limits enforced by the nested agent
 * tools below.
 */
const CHILD_DENIED_TOOL_NAMES: string[] = [...Object.values(SUBAGENT_TOOL_NAMES), "pi_exec"];

/** Child sessions: no discovery; explicit fast-mode/safety/context extensions, MCP, and optional pair. */
export function childSessionExtensions(
	pair = false,
	standard = true,
	readOnly = false,
): {
	noExtensions: true;
	additionalExtensionPaths: string[];
} {
	const additionalExtensionPaths = [
		AUTO_COMPACT_EXTENSION_PATH,
		CODEX_FAST_EXTENSION_PATH,
		HOME_SEARCH_GUARD_EXTENSION_PATH,
	];
	if (standard) {
		additionalExtensionPaths.push(LEDGER_EXTENSION_PATH, SESSION_SEARCH_EXTENSION_PATH, MCP_EXTENSION_PATH);
		if (pair) additionalExtensionPaths.push(PAIR_EXTENSION_PATH);
	} else if (readOnly) {
		additionalExtensionPaths.push(SESSION_SEARCH_EXTENSION_PATH);
	}
	return { noExtensions: true, additionalExtensionPaths };
}

/** Default max turns. undefined = unlimited (no turn limit). */
let defaultMaxTurns: number | undefined;

/** Normalize max turns. undefined or 0 = unlimited, otherwise minimum 1. */
export function normalizeMaxTurns(n: number | undefined): number | undefined {
	if (n == null || n === 0) return undefined;
	return Math.max(1, n);
}

/** Get the default max turns value. undefined = unlimited. */
export function getDefaultMaxTurns(): number | undefined {
	return defaultMaxTurns;
}
/** Set the default max turns value. undefined or 0 = unlimited, otherwise minimum 1. */
export function setDefaultMaxTurns(n: number | undefined): void {
	defaultMaxTurns = normalizeMaxTurns(n);
}

/**
 * Project default for `persist_session`. Persisted Pi session JSONL is the
 * authoritative subagent transcript. Per-agent frontmatter may opt out.
 */
let persistAgentSessions = true;

export function getPersistAgentSessions(): boolean {
	return persistAgentSessions;
}
export function setPersistAgentSessions(enabled: boolean): void {
	persistAgentSessions = enabled;
}

/** Additional turns allowed after the soft limit steer message. */
let graceTurns = 5;

/** Get the grace turns value. */
export function getGraceTurns(): number {
	return graceTurns;
}
/** Set the grace turns value (minimum 1). */
export function setGraceTurns(n: number): void {
	graceTurns = Math.max(1, n);
}

/** Info about a tool event in the subagent. */
export interface ToolActivity {
	type: "start" | "end";
	toolName: string;
}

/**
 * Apply the final model precedence after config routing has run.
 * An explicit Model object is already resolved and must not be blocked by a
 * lower-priority config/frontmatter lookup failure.
 */
export function selectAgentModel(
	explicitModel: Model<any> | undefined,
	resolved: { model: Model<any> | undefined; error?: string },
): Model<any> | undefined {
	if (!explicitModel && resolved.error) throw new Error(resolved.error);
	return explicitModel ?? resolved.model;
}

export interface RunOptions {
	/** ExtensionAPI instance — used for pi.exec() instead of execSync. */
	pi: ExtensionAPI;
	/** Manager-assigned id; suffixes session name to disambiguate parallel spawns (e.g. `explorer#a1b2c3d4`). */
	agentId?: string;
	model?: Model<any>;
	/** True when the caller has already resolved model routing at its spawn boundary. */
	modelResolved?: boolean;
	maxTurns?: number;
	/** Abort on the exact turn boundary instead of steering through the public grace window. */
	hardTurnLimit?: boolean;
	toolExecution?: "sequential" | "parallel";
	/** Exact enabled config captured at dispatch. Execution must not re-read mutable role policy when present. */
	agentConfig?: AgentConfig;
	/** Invocation-level guidance appended after the selected definition and skills. */
	systemPrompt?: string;
	/** Enforcement that runs before the session's existing beforeToolCall hook. */
	toolPolicy?: ManagedAgentToolPolicy;
	/** Controller-supplied SDK tools, independent of extension discovery. */
	customTools?: ToolDefinition[];
	/** Disable ledger, session-search, MCP, and optional pair programmer; fast mode and both safety guards remain mandatory. */
	loadStandardChildExtensions?: boolean;
	signal?: AbortSignal;
	isolated?: boolean;
	inheritContext?: boolean;
	pair?: boolean;
	thinkingLevel?: ThinkingLevel;
	/**
	 * True when another agent spawned this one. Nested runs stay in memory by
	 * default because their output is recorded by the owning agent session.
	 */
	nested?: boolean;
	/** Override the tools' working directory. */
	cwd?: string;
	/**
	 * Where .pi config is discovered (project extensions, skills, pi settings,
	 * agent definitions). Default: same as the working directory. The manager sets
	 * this to the parent session's cwd when `SpawnOptions.cwd` points the
	 * working directory elsewhere — the agent works *there* but carries the
	 * parent project's config (the target's `.pi` extensions never execute).
	 *
	 * WARNING for future callers: if you pass `cwd` pointing at a directory the
	 * user didn't open, you almost certainly must pass `configCwd` too —
	 * omitting it makes the target's `.pi` extensions execute in this process.
	 */
	configCwd?: string;
	/** Called on tool start/end with activity info. */
	onToolActivity?: (activity: ToolActivity) => void;
	/** Called on streaming text deltas from the assistant response. */
	onTextDelta?: (delta: string, fullText: string) => void;
	onSessionCreated?: (session: AgentSession) => void;
	/** Called at the end of each agentic turn with the cumulative count. */
	onTurnEnd?: (turnCount: number) => void;
	/**
	 * Called once per assistant message_end with that message's usage delta.
	 * Lets callers maintain a lifetime accumulator that survives compaction
	 * (which replaces session.state.messages and resets stats-derived sums).
	 */
	onAssistantUsage?: (usage: AssistantUsageDelta) => void;
	/**
	 * Called when the session successfully compacts. `tokensBefore` is upstream's
	 * pre-compaction context size estimate. Aborted compactions don't fire.
	 */
	onCompaction?: (info: { reason: "manual" | "threshold" | "overflow"; tokensBefore: number }) => void;
	/** Runtime bridge for opt-in child-safe nested delegation. */
	nestedRuntime?: {
		manager: NestedAgentManager;
		parentAgentId: string;
		depth: number;
		maxSubagentDepth?: number;
	};
}

export interface RunResult {
	responseText: string;
	session: AgentSession;
	/** True if the agent was hard-aborted (max_turns + grace exceeded). */
	aborted: boolean;
	/** True if the agent was steered to wrap up (hit soft turn limit) but finished in time. */
	steered: boolean;
	/**
	 * A failure message for the run's FINAL assistant turn, when that turn failed:
	 * a provider error (stopReason "error"), or a "length" stop that produced no
	 * text (a silent max-token death). pi resolves an exhausted-retries failure
	 * normally instead of rejecting, so without this the manager would report such
	 * a run as completed — with an empty result, or worse, an earlier turn's text
	 * presented as the answer (#144). Undefined for a clean stop, or a "length"
	 * stop that produced text (a legitimate truncated answer).
	 */
	failure?: string;
}

/**
 * Subscribe to a session and collect the last assistant message text.
 * Returns an object with a `getText()` getter and an `unsubscribe` function.
 */
function collectResponseText(session: AgentSession) {
	let text = "";
	const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
		// message_start also fires for user and toolResult messages — resetting on
		// those would wipe assistant text already collected. Reset only when a new
		// ASSISTANT message begins, so getText() is the last assistant message's text.
		if (event.type === "message_start" && event.message.role === "assistant") {
			text = "";
		}
		if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
			text += event.assistantMessageEvent.delta;
		}
	});
	return { getText: () => text, unsubscribe };
}

/**
 * Get the last non-empty assistant text produced during THIS invocation.
 * `startIndex` is the message count captured before the prompt, so the walk-back
 * never crosses into a previous turn: on a resume whose new turn failed empty,
 * this returns "" instead of the prior turn's answer (#144). Defaults to 0 (a
 * fresh spawn, where the whole history belongs to this run).
 */
function getLastAssistantText(session: AgentSession, startIndex = 0): string {
	for (let i = session.messages.length - 1; i >= startIndex; i--) {
		const msg = session.messages[i];
		if (msg.role !== "assistant") continue;
		const text = extractText(msg.content).trim();
		if (text) return text;
	}
	return "";
}

/**
 * Error message of THIS invocation's final assistant message, when that turn
 * failed. Three failure shapes, all keyed off how the final turn STOPPED:
 *   - stopReason "error": a provider failure pi resolved instead of rejecting
 *     (any text; partial output is surfaced separately).
 *   - stopReason "length" with NO text: a silent max-token death — the run hit
 *     the output-token ceiling before writing anything, which would otherwise
 *     land as a "completed" run with an empty result (the #144 symptom).
 *   - any non-"toolUse" stop with NO text: a clean terminal stop that must not
 *     report completed with an earlier message as its final answer.
 * Everything else completes: a "toolUse" stop (which is not terminal), and —
 * crucially — a "length" or "stop" stop that DID produce text.
 * "aborted" is handled by the manager's abort flag / "stopped" guard, not here.
 * Bounded by `startIndex` (like the text fallback) so a resume that produced no
 * assistant message of its own never inherits a PRIOR turn's stop reason.
 */
function finalTurnError(session: AgentSession, startIndex = 0): string | undefined {
	for (let i = session.messages.length - 1; i >= startIndex; i--) {
		const msg = session.messages[i];
		if (msg.role !== "assistant") continue;
		if (msg.stopReason === "error") {
			return (msg as { errorMessage?: string }).errorMessage?.trim() || "provider error with no output";
		}
		const text = extractText(msg.content).trim();
		if (msg.stopReason === "length" && !text) {
			return "run hit the output token limit before producing any text";
		}
		if (msg.stopReason !== "toolUse" && !text) {
			return "run ended without producing any text";
		}
		return undefined;
	}
	return undefined;
}

/**
 * Wire an AbortSignal to abort a session.
 * Returns a cleanup function to remove the listener.
 */
function forwardAbortSignal(session: AgentSession, signal?: AbortSignal): () => void {
	if (!signal) return () => {};
	const onAbort = () => session.abort();
	if (signal.aborted) session.abort();
	else signal.addEventListener("abort", onAbort, { once: true });
	return () => signal.removeEventListener("abort", onAbort);
}

function resolveConfiguredSessionDir(sessionDir: string | undefined, cwd: string): string | undefined {
	if (!sessionDir) return undefined;
	if (sessionDir === "~" || sessionDir.startsWith("~/")) return resolve(homedir(), sessionDir.slice(2));
	if (isAbsolute(sessionDir)) return sessionDir;
	return resolve(cwd, sessionDir);
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: AgentSession lifecycle transitions share cancellation, compaction, and usage state.
export async function runAgent(
	ctx: ExtensionContext,
	type: SubagentType,
	prompt: string,
	options: RunOptions,
): Promise<RunResult> {
	const suppliedAgentConfig = options.agentConfig;
	const agentConfig = suppliedAgentConfig ?? getAgentConfig(type);
	if (!agentConfig || agentConfig.enabled === false) {
		throw new Error(`Unknown or disabled agent type: "${type}"`);
	}
	const config = {
		displayName: agentConfig.displayName ?? agentConfig.name,
		color: agentConfig.color,
		description: agentConfig.description,
		builtinToolNames: agentConfig.builtinToolNames ?? BUILTIN_TOOL_NAMES,
		extensions: agentConfig.extensions,
		excludeExtensions: agentConfig.excludeExtensions,
		skills: agentConfig.skills,
		promptMode: agentConfig.promptMode,
	};
	const projectTrusted = typeof ctx.isProjectTrusted === "function" ? ctx.isProjectTrusted() : false;

	// Resolve working directory: explicit override > parent cwd.
	const effectiveCwd = options.cwd ?? ctx.cwd;
	// Filesystem work happens in effectiveCwd; config discovery in configCwd.
	// They differ only for SpawnOptions.cwd spawns (config stays with the parent).
	const configCwd = options.configCwd ?? effectiveCwd;

	const env = await detectEnv(options.pi, effectiveCwd);

	// Get parent system prompt for append-mode agents
	const parentSystemPrompt = ctx.getSystemPrompt();

	// Build invocation extras; durable memory remains session-owned.
	const extras: PromptExtras = { additionalSystemPrompt: options.systemPrompt };

	// Skills: isolated turns them off. Extensions never inherit from the package.
	const skills = options.isolated ? false : config.skills;

	// Skill preloading: when skills is string[], preload their content into prompt
	if (Array.isArray(skills)) {
		const loaded = preloadSkills(skills, configCwd, projectTrusted);
		if (loaded.length > 0) {
			extras.skillBlocks = loaded;
		}
	}

	const toolNames = suppliedAgentConfig
		? (suppliedAgentConfig.builtinToolNames ?? [...BUILTIN_TOOL_NAMES])
		: getToolNamesForType(type);

	// Build system prompt from the validated agent config.
	const systemPrompt = buildAgentPrompt(agentConfig, effectiveCwd, env, parentSystemPrompt, extras);

	// When skills is string[], we've already preloaded them into the prompt.
	// Still pass noSkills: true since we don't need the skill loader to load them again.
	const noSkills = skills === false || Array.isArray(skills);

	const agentDir = getAgentDir();
	const settingsManager = SettingsManager.create(configCwd, agentDir, { projectTrusted });

	// Same `--no-extensions` plus explicit `-e` contract as pi_exec workers.
	// Ordinary children load fast mode, the overflow guard, the home-search guard, ledger, session search,
	// MCP, and optional pair programmer; narrowly owned internal sessions may opt out of everything except fast mode
	// and the safety guards. Suppress
	// AGENTS.md/CLAUDE.md and APPEND_SYSTEM.md — upstream's buildSystemPrompt()
	// re-appends both AFTER systemPromptOverride, which would defeat
	// prompt_mode: replace. Parent context, when requested, is prepended to
	// the task prompt below. Agent-definition `extensions:` is ignored.
	// Read-only default roles receive no standard extension surface either:
	// ledger and MCP can register mutation-capable tools independently of the
	// built-in allowlist. This makes their policy structural, not prompt-based.
	const structurallyReadOnly = new Set(["explorer", "planner", "researcher", "consultant"]).has(agentConfig.name);
	const { noExtensions, additionalExtensionPaths } = childSessionExtensions(
		options.pair === true,
		options.loadStandardChildExtensions !== false && !structurallyReadOnly,
		structurallyReadOnly,
	);

	const loader = new DefaultResourceLoader({
		cwd: configCwd,
		agentDir,
		settingsManager,
		noExtensions,
		additionalExtensionPaths,
		noSkills,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		systemPromptOverride: () => systemPrompt,
		appendSystemPromptOverride: () => [],
	});
	await runInChildSessionContext(() => loader.reload());

	// Plain entries in `tools:` are expected to be built-in names (extension tools
	// go through `ext:`), so an unknown name there is unambiguously a typo. Previously
	// this produced a silently broken agent (#75) — pi-mono accepted the bogus name
	// into the allowlist, then dropped it at registration with no signal back.
	if (agentConfig?.builtinToolNames?.length) {
		const knownBuiltins = new Set(BUILTIN_TOOL_NAMES);
		for (const name of agentConfig.builtinToolNames) {
			if (!knownBuiltins.has(name)) {
				notifyObserver(options.onToolActivity, {
					type: "end",
					toolName: `tools-error:tool "${name}" requested by agent "${type}" is not a known built-in`,
				});
			}
		}
	}

	// Top-level and nested agent tools resolve routing before queueing a spawn so
	// queued work cannot observe a later config change. Direct runagent callers
	// retain the same resolution here.
	const resolvedProfile = options.modelResolved
		? { model: options.model, thinkingLevel: options.thinkingLevel }
		: resolveAgentProfile({
				registry: ctx.modelRegistry,
				parentModel: ctx.model,
				parentThinking: ctx.thinkingLevel,
				config: agentConfig,
			});
	const model = selectAgentModel(options.model, resolvedProfile);
	const thinkingLevel = options.thinkingLevel ?? resolvedProfile.thinkingLevel;

	const disallowedSet = agentConfig?.disallowedTools ? new Set(agentConfig.disallowedTools) : undefined;

	// Nested delegation tools (opt-in, ownership-scoped). Empty unless the agent
	// set `allowed_subagents` and a nestedRuntime was provided — and never when
	// isolated. Their names collide with CHILD_DENIED_TOOL_NAMES by design, so
	// the scoping below re-admits them explicitly (registry deny + active-set narrow).
	const effectiveMaxDepth = options.nestedRuntime?.maxSubagentDepth ?? getMaxSubagentDepth();
	// At (or past) the cap this agent can never spawn, so it can never own a child
	// to inspect, steer, or stop either — inject nothing rather than orchestration
	// tools whose every call is an error. This is also what makes `maxSubagentDepth` 0/1 mean
	// "nesting off" instead of "nesting always fails".
	const nestedRuntime =
		options.nestedRuntime && options.nestedRuntime.depth < effectiveMaxDepth ? options.nestedRuntime : undefined;
	const nestedTools =
		agentConfig?.allowedSubagents && nestedRuntime && !options.isolated
			? createNestedSubagentTools({
					manager: nestedRuntime.manager,
					pi: options.pi,
					parentAgentId: nestedRuntime.parentAgentId,
					depth: nestedRuntime.depth,
					maxSubagentDepth: effectiveMaxDepth,
					allowedSubagents: agentConfig.allowedSubagents,
					configCwd,
					projectTrusted,
				})
			: [];
	const nestedToolNames = new Set(nestedTools.map((tool) => tool.name));
	const customTools = [...nestedTools, ...(options.customTools ?? [])];
	const customToolNames = new Set(customTools.map((tool) => tool.name));
	if (customToolNames.size !== customTools.length)
		throw new Error(`Agent "${type}" received duplicate custom tool names`);

	// ledger (and optional pair) load via explicit `-e`, so their tools must
	// be able to register. Leave `allowedToolNames` unset and deny the stable
	// names that must never appear: orchestration tools the agent did not opt
	// into, built-ins it did not ask for, and `disallowedTools`.
	const builtinToolNameSet = new Set(toolNames);
	const denyTools = new Set<string>(CHILD_DENIED_TOOL_NAMES.filter((t) => !nestedToolNames.has(t)));
	for (const name of BUILTIN_TOOL_NAMES) {
		if (!builtinToolNameSet.has(name)) denyTools.add(name);
	}
	if (disallowedSet) {
		for (const name of disallowedSet) denyTools.add(name);
	}
	const sessionExcludeTools = [...denyTools];

	const configuredSessionDir = resolveConfiguredSessionDir(agentConfig?.sessionDir, effectiveCwd);
	const defaultSessionDir = process.env.PI_CODING_AGENT_SESSION_DIR ?? settingsManager.getSessionDir?.();
	// Frontmatter wins; top-level sessions persist by default so child
	// transcripts remain searchable via search_session.
	// Nested children stay in memory unless explicitly persisted by their own
	// definition: their result is already recorded in the owning agent session.
	const persistSession = agentConfig?.persistSession ?? (options.nested ? false : persistAgentSessions);
	const sessionManager = persistSession
		? SessionManager.create(effectiveCwd, configuredSessionDir ?? defaultSessionDir, {
				parentSession: ctx.sessionManager?.getSessionFile?.(),
			})
		: SessionManager.inMemory(effectiveCwd);

	// Pi 0.80.8 replaced createAgentSession's modelRegistry option with
	// modelRuntime, but ExtensionContext still exposes only the registry facade.
	// Pass both so the full supported Pi range retains the parent's providers.
	const parentModelRuntime = (ctx.modelRegistry as unknown as { runtime?: unknown }).runtime;
	const sessionOpts: Parameters<typeof createAgentSession>[0] & {
		modelRegistry: ExtensionContext["modelRegistry"];
		modelRuntime?: unknown;
	} = {
		cwd: effectiveCwd,
		agentDir,
		sessionManager,
		settingsManager,
		modelRegistry: ctx.modelRegistry,
		// `as never` is what keeps this assignable across the supported Pi range:
		// pre-0.80.8 the field exists only via the `modelRuntime?: unknown` shim
		// above, while newer Pi types it as `ModelRuntime` — a shape an opaque
		// `unknown` read off the private facade field can never satisfy.
		...(parentModelRuntime !== undefined && { modelRuntime: parentModelRuntime as never }),
		model,
		excludeTools: sessionExcludeTools,
		customTools,
		resourceLoader: loader,
	};
	if (thinkingLevel) {
		sessionOpts.thinkingLevel = thinkingLevel;
	}

	const { session } = await runInChildSessionContext(() => createAgentSession(sessionOpts));

	const baseSessionName = agentConfig?.name ?? type;
	session.setSessionName(options.agentId ? `${baseSessionName}#${options.agentId.slice(0, 8)}` : baseSessionName);

	// Bind the explicit `-e` extensions so session_start fires. Registry scope
	// is `excludeTools` from session construction. Stay in child-session ALS so
	// a leaked context.ts factory cannot register the pair programmer notebook.
	await runInChildSessionContext(() =>
		session.bindExtensions({
			onError: (err) => {
				notifyObserver(options.onToolActivity, {
					type: "end",
					toolName: `extension-error:${err.extensionPath}`,
				});
			},
		}),
	);

	// Pi activates a small built-in default at turn 1. Promote every registered
	// tool that excludeTools did not deny, including ledger_add / ledger_close.
	const denied = new Set(sessionExcludeTools);
	session.setActiveToolsByName(
		session
			.getAllTools()
			.map((tool) => tool.name)
			.filter((name) => !denied.has(name)),
	);

	if (options.toolExecution) session.agent.toolExecution = options.toolExecution;

	if (options.toolPolicy) {
		const priorBeforeToolCall = session.agent.beforeToolCall;
		session.agent.beforeToolCall = async (context, signal) => {
			const decision = await options.toolPolicy?.(
				{
					toolName: context.toolCall.name,
					args: context.args,
				},
				signal,
			);
			if (decision) return decision;
			return priorBeforeToolCall?.(context, signal);
		};
	}

	notifyObserver(options.onSessionCreated, session);

	// Track turns for graceful max_turns enforcement
	let turnCount = 0;
	const maxTurns = normalizeMaxTurns(options.maxTurns ?? agentConfig?.maxTurns ?? defaultMaxTurns);
	let softLimitReached = false;
	let aborted = false;

	let currentMessageText = "";
	const unsubTurns = session.subscribe((event: AgentSessionEvent) => {
		if (event.type === "turn_end") {
			turnCount++;
			notifyObserver(options.onTurnEnd, turnCount);
			if (maxTurns != null) {
				if (options.hardTurnLimit && turnCount >= maxTurns) {
					aborted = true;
					session.abort();
				} else if (!softLimitReached && turnCount >= maxTurns) {
					softLimitReached = true;
					session.steer(
						"You have reached your configured turn limit. Stop investigating and provide your final answer now. Preserve fidelity: include all material findings, exact evidence, caveats, and unresolved work. Do not abbreviate merely because the turn limit was reached; use as much of this response as needed.",
					);
				} else if (softLimitReached && turnCount >= maxTurns + graceTurns) {
					aborted = true;
					session.abort();
				}
			}
		}
		if (event.type === "message_start") {
			currentMessageText = "";
		}
		if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
			currentMessageText += event.assistantMessageEvent.delta;
			notifyObserver(options.onTextDelta, event.assistantMessageEvent.delta, currentMessageText);
		}
		if (event.type === "tool_execution_start") {
			notifyObserver(options.onToolActivity, { type: "start", toolName: event.toolName });
		}
		if (event.type === "tool_execution_end") {
			notifyObserver(options.onToolActivity, { type: "end", toolName: event.toolName });
		}
		if (event.type === "message_end" && event.message.role === "assistant") {
			const u = (event.message as any).usage;
			if (u)
				notifyObserver(options.onAssistantUsage, {
					input: u.input ?? 0,
					cacheRead: u.cacheRead ?? 0,
					cacheWrite: u.cacheWrite ?? 0,
					output: u.output ?? 0,
					cost: typeof u.cost === "number" ? u.cost : (u.cost?.total ?? 0),
				});
		}
		if (event.type === "compaction_end" && !event.aborted && event.result) {
			notifyObserver(options.onCompaction, { reason: event.reason, tokensBefore: event.result.tokensBefore });
		}
	});

	const collector = collectResponseText(session);
	const cleanupAbort = forwardAbortSignal(session, options.signal);

	// A task prompt is the entire handoff unless this invocation explicitly
	// requests the parent conversation.
	let effectivePrompt = prompt;
	if (options.inheritContext === true) {
		const parentContext = buildFullParentContext(ctx);
		if (parentContext) effectivePrompt = parentContext + prompt;
	}

	// Boundary for the history fallback: only assistant text produced from here
	// on counts as this run's output (a fresh session, so usually 0).
	const startLen = session.messages.length;
	try {
		await session.prompt(effectivePrompt);
	} finally {
		unsubTurns();
		collector.unsubscribe();
		cleanupAbort();
	}

	const responseText = collector.getText().trim() || getLastAssistantText(session, startLen);
	return { responseText, session, aborted, steered: softLimitReached, failure: finalTurnError(session, startLen) };
}

/**
 * Send a new prompt to an existing session (resume).
 */
export async function resumeAgent(
	session: AgentSession,
	prompt: string,
	options: {
		onToolActivity?: (activity: ToolActivity) => void;
		onAssistantUsage?: (usage: AssistantUsageDelta) => void;
		onCompaction?: (info: { reason: "manual" | "threshold" | "overflow"; tokensBefore: number }) => void;
		onTextDelta?: (delta: string, fullText: string) => void;
		onTurnEnd?: (turnCount: number) => void;
		maxTurns?: number;
		hardTurnLimit?: boolean;
		signal?: AbortSignal;
	} = {},
): Promise<{ text: string; failure?: string; aborted: boolean; steered: boolean }> {
	// Boundary for the history fallback: the session already holds prior turns,
	// so only assistant text produced by THIS resume prompt counts as its output
	// — a failed resume must not surface the previous turn's answer (#144).
	const startLen = session.messages.length;
	const collector = collectResponseText(session);
	const cleanupAbort = forwardAbortSignal(session, options.signal);

	let turnCount = 0;
	let softLimitReached = false;
	let aborted = false;
	const maxTurns = normalizeMaxTurns(options.maxTurns);
	let currentMessageText = "";
	const unsubEvents =
		options.onToolActivity ||
		options.onAssistantUsage ||
		options.onCompaction ||
		options.onTextDelta ||
		options.onTurnEnd ||
		maxTurns != null
			? session.subscribe(
					// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: this callback owns the resumed turn's ceiling, activity, usage, and compaction events.
					(event: AgentSessionEvent) => {
						if (event.type === "turn_end") {
							turnCount++;
							notifyObserver(options.onTurnEnd, turnCount);
							if (maxTurns != null) {
								if (options.hardTurnLimit && turnCount >= maxTurns) {
									aborted = true;
									session.abort();
								} else if (!softLimitReached && turnCount >= maxTurns) {
									softLimitReached = true;
									session.steer(
										"You have reached your configured turn limit. Stop investigating and provide your final answer now.",
									);
								} else if (softLimitReached && turnCount >= maxTurns + graceTurns) {
									aborted = true;
									session.abort();
								}
							}
						}
						if (event.type === "message_start") currentMessageText = "";
						if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
							currentMessageText += event.assistantMessageEvent.delta;
							notifyObserver(options.onTextDelta, event.assistantMessageEvent.delta, currentMessageText);
						}
						if (event.type === "tool_execution_start")
							notifyObserver(options.onToolActivity, { type: "start", toolName: event.toolName });
						if (event.type === "tool_execution_end")
							notifyObserver(options.onToolActivity, { type: "end", toolName: event.toolName });
						if (event.type === "message_end" && event.message.role === "assistant") {
							const u = (event.message as any).usage;
							if (u)
								notifyObserver(options.onAssistantUsage, {
									input: u.input ?? 0,
									cacheRead: u.cacheRead ?? 0,
									cacheWrite: u.cacheWrite ?? 0,
									output: u.output ?? 0,
									cost: typeof u.cost === "number" ? u.cost : (u.cost?.total ?? 0),
								});
						}
						if (event.type === "compaction_end" && !event.aborted && event.result) {
							notifyObserver(options.onCompaction, {
								reason: event.reason,
								tokensBefore: event.result.tokensBefore,
							});
						}
					},
				)
			: () => {};

	try {
		await session.prompt(prompt);
	} finally {
		collector.unsubscribe();
		unsubEvents();
		cleanupAbort();
	}

	return {
		text: collector.getText().trim() || getLastAssistantText(session, startLen),
		failure: finalTurnError(session, startLen),
		aborted,
		steered: softLimitReached,
	};
}

/**
 * Send a steering message to a running subagent.
 * The message will interrupt the agent after its current tool execution.
 */
export async function steerAgent(session: AgentSession, message: string): Promise<void> {
	await session.steer(message);
}
