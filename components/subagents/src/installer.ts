import {
	defineTool,
	type ExtensionAPI,
	type ExtensionCommandContext,
	getMarkdownTheme,
} from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { INFERENCE_PROFILE_CATALOG } from "../../shared/src/model-profiles.js";
import { type ResultWaitMode, resolveResultWaitMode, waitForAgentSettlement } from "./abortable.js";
import { createActivityTracker } from "./activity.js";
import { renderAgentName } from "./agent-color.js";
import { registerBtwCommand } from "./btw.js";
import { AgentManager, disposeAgentSession } from "./agent-manager.js";
import {
	getAgentConversation,
	getDefaultMaxTurns,
	normalizeMaxTurns,
	SUBAGENT_TOOL_NAMES,
	setDefaultMaxTurns,
	setGraceTurns,
	setPersistAgentSessions,
} from "./agent-runner.js";
import {
	getAgentConfig,
	getAvailableTypes,
	registerAgents,
	resolveSpawnType,
	setDefaultsDisabled,
} from "./agent-types.js";
import { inChildSessionContext } from "./child-context.js";
import { loadCustomAgents } from "./custom-agents.js";
import { GroupJoinManager } from "./group-join.js";
import { resolveAgentInvocationConfig, resolveJoinMode } from "./invocation-config.js";
import { INFERENCE_PROFILE_PARAMETER_SCHEMA, resolveAgentProfile } from "./model-routing.js";
import { getMaxSubagentDepth, setMaxSubagentDepth } from "./nested-tools.js";
import { detailsFor, formatNotification, notificationDetails } from "./notifications.js";
import { installManagedSubagentService, type ManagedSubagentService } from "./service.js";
import { applyCompleteSettings, loadSettings } from "./settings.js";
import { continuationSuffix, getForegroundOutcomeNote, partialOutputSuffix } from "./status-note.js";
import {
	appendTeamSystemPrompt,
	INFERENCE_PROFILES_SYSTEM_PROMPT_TAG,
	TEAM_SYSTEM_PROMPT_TAG,
	type TeamMember,
	toTeamMember,
} from "./team-system-prompt.js";
import type {
	AgentInvocation,
	AgentRecord,
	JoinMode,
	NotificationDetails,
	SubagentConfigScope,
	WidgetMode,
} from "./types.js";
import {
	type AgentActivity,
	type AgentDetails,
	AgentWidget,
	describeActivity,
	fgPreservingNestedStyles,
	formatMs,
	formatTokens,
	formatTurns,
	renderRunningAgentStatus,
	SPINNER,
} from "./ui/agent-widget.js";
import { ConversationViewer, VIEWPORT_HEIGHT_PCT } from "./ui/conversation-viewer.js";
import { FleetList } from "./ui/fleet-list.js";

function textResult(text: string, details?: AgentDetails, isError = false) {
	return { content: [{ type: "text" as const, text }], details: details as any, isError };
}

export default function installSubagents(pi: ExtensionAPI): void {
	// Child sessions load ledger, session_search, and MCP via explicit `-e` and never create
	// a second manager. Nested tools are injected explicitly.
	if (inChildSessionContext()) return;

	let strictAgentFiles = false;
	const reloadAgents = (scope: SubagentConfigScope, strict = strictAgentFiles) =>
		registerAgents(loadCustomAgents(scope, strict));
	registerAgents(new Map());

	const activityById = new Map<string, AgentActivity>();
	let widgetMode: WidgetMode = "background";
	let fleetEnabled = true;
	let defaultJoinMode: JoinMode = "smart";

	const pendingNotifications = new Map<string, ReturnType<typeof setTimeout>>();
	const cancelNotification = (key: string) => {
		const timer = pendingNotifications.get(key);
		if (timer) clearTimeout(timer);
		pendingNotifications.delete(key);
	};
	const queueNotification = (key: string, send: () => void) => {
		cancelNotification(key);
		pendingNotifications.set(
			key,
			setTimeout(() => {
				pendingNotifications.delete(key);
				send();
			}, 200),
		);
	};

	let manager!: AgentManager;
	let widget!: AgentWidget;
	let fleet!: FleetList;
	const backgroundCompletions = new Map<string, (record: AgentRecord) => void>();
	const lifecycleCancelledIds = new Set<string>();
	const settleBackgroundCompletion = (record: AgentRecord) => {
		const resolve = backgroundCompletions.get(record.id);
		if (!resolve) return;
		backgroundCompletions.delete(record.id);
		resolve(record);
	};

	const finishUi = (record: AgentRecord) => {
		widget.markFinished(record.id);
		fleet.onAgentFinished(record.id);
		widget.update();
		fleet.update();
	};

	const emitNudge = (record: AgentRecord) => {
		if (record.resultConsumed) return;
		pi.sendMessage<NotificationDetails>(
			{
				customType: "subagent-notification",
				content: formatNotification(record, 500),
				display: true,
				details: notificationDetails(record, 500, activityById.get(record.id)),
			},
			{ deliverAs: "followUp", triggerTurn: true },
		);
	};

	const groupJoin = new GroupJoinManager((records, partial) => {
		for (const record of records) finishUi(record);
		const key = `group:${records.map((record) => record.id).join(",")}`;
		queueNotification(key, () => {
			const unconsumed = records.filter((record) => !record.resultConsumed);
			if (unconsumed.length === 0) return;
			const [first, ...rest] = unconsumed;
			const details = notificationDetails(first, 300, activityById.get(first.id));
			if (rest.length)
				details.others = rest.map((record) => notificationDetails(record, 300, activityById.get(record.id)));
			pi.sendMessage<NotificationDetails>(
				{
					customType: "subagent-notification",
					content: `${partial ? "Partial background agent group" : "Background agent group completed"}\n\n${unconsumed.map((record) => formatNotification(record, 300)).join("\n\n")}`,
					display: true,
					details,
				},
				{ deliverAs: "followUp", triggerTurn: true },
			);
		});
	});

	let currentBatch: { id: string; joinMode: JoinMode }[] = [];
	let batchTimer: ReturnType<typeof setTimeout> | undefined;
	let batchNumber = 0;
	const finalizeBatch = () => {
		batchTimer = undefined;
		const batch = currentBatch;
		currentBatch = [];
		const grouped = batch.filter(({ joinMode }) => joinMode === "smart" || joinMode === "group");
		if (grouped.length >= 2 || (grouped.length === 1 && grouped[0].joinMode === "group")) {
			const ids = grouped.map(({ id }) => id);
			groupJoin.registerGroup(`batch-${++batchNumber}`, ids);
			for (const id of ids) {
				const record = manager.getRecord(id);
				if (record?.completedAt) groupJoin.onAgentComplete(record);
			}
		} else {
			for (const { id } of batch) {
				const record = manager.getRecord(id);
				if (record?.completedAt && !record.resultConsumed) queueNotification(id, () => emitNudge(record));
			}
		}
	};
	const trackBatch = (id: string, joinMode: JoinMode) => {
		currentBatch.push({ id, joinMode });
		if (batchTimer) clearTimeout(batchTimer);
		batchTimer = setTimeout(finalizeBatch, 100);
	};

	manager = new AgentManager(
		(record) => {
			settleBackgroundCompletion(record);
			const lifecycleCancelled = lifecycleCancelledIds.delete(record.id);
			if (record.parentAgentId) return;
			if (lifecycleCancelled) {
				finishUi(record);
				return;
			}
			if (record.internalOwner) {
				finishUi(record);
				return;
			}
			const failed = ["error", "stopped", "aborted"].includes(record.status);
			pi.events.emit(failed ? "subagents:failed" : "subagents:completed", {
				id: record.id,
				type: record.type,
				description: record.description,
				status: record.status,
				result: record.result,
				error: record.error,
				sessionFile: record.sessionFile,
			});
			finishUi(record);
			if (currentBatch.some(({ id }) => id === record.id)) return;
			const groupOutcome = groupJoin.onAgentComplete(record);
			if (record.resultConsumed) return;
			if (groupOutcome === "pass") queueNotification(record.id, () => emitNudge(record));
		},
		undefined,
		(record) => {
			if (record.parentAgentId || record.internalOwner) return;
			widget.markRunning(record.id);
			widget.ensureTimer();
			fleet.ensureTimer();
			widget.update();
			fleet.update();
			pi.events.emit("subagents:started", { id: record.id, type: record.type, description: record.description });
		},
		(record, info) => {
			if (!record.parentAgentId && !record.internalOwner)
				pi.events.emit("subagents:compacted", { id: record.id, ...info, compactionCount: record.compactionCount });
		},
	);
	widget = new AgentWidget(manager, activityById, () => widgetMode);
	fleet = new FleetList(manager, activityById);
	registerBtwCommand(pi, manager);

	const managedService: ManagedSubagentService = {
		startBackground(ctx, request) {
			bindSessionContext(ctx);
			const dispatch = resolveSpawnType(request.type);
			if (!dispatch.ok) throw new Error(dispatch.message);
			const agentConfig = getAgentConfig(dispatch.type);
			if (!agentConfig) throw new Error(`Unknown or disabled agent type: "${request.type}"`);
			const resolved = resolveAgentProfile({
				registry: ctx.modelRegistry,
				parentModel: ctx.model,
				parentThinking: ctx.thinkingLevel,
				config: agentConfig,
				explicitProfile: request.profile,
			});
			if (resolved.error) throw new Error(resolved.error);
			const invocation = resolveAgentInvocationConfig(agentConfig, { run_in_background: true });
			const maxTurns = normalizeMaxTurns(invocation.maxTurns ?? getDefaultMaxTurns());
			const tracker = createActivityTracker(
				maxTurns,
				() => {
					widget.update();
					fleet.update();
				},
				request.onActivity,
			);
			const id = manager.spawn(pi, ctx, dispatch.type, request.prompt, {
				description: request.description,
				agentConfig,
				model: resolved.model,
				modelResolved: true,
				maxTurns,
				systemPrompt: invocation.systemPrompt,
				isolated: invocation.isolated,
				inheritContext: false,
				advisor: invocation.advisor,
				thinkingLevel: resolved.thinkingLevel,
				cwd: request.cwd,
				isBackground: true,
				onToolActivity: tracker.callbacks.onToolActivity,
				onTextDelta: tracker.callbacks.onTextDelta,
				onTurnEnd: tracker.callbacks.onTurnEnd,
				onAssistantUsage: (usage) => {
					tracker.callbacks.onAssistantUsage(usage);
					request.onAssistantUsage?.(usage);
				},
				onSessionCreated: tracker.callbacks.onSessionCreated,
				invocation: {
					modelName: resolved.model ? `${resolved.model.provider}/${resolved.model.id}` : undefined,
					profile: resolved.profile,
					systemPrompt: invocation.systemPrompt,
					thinking: resolved.thinkingLevel,
					maxTurns,
					isolated: invocation.isolated,
					inheritContext: false,
					advisor: invocation.advisor,
					runInBackground: true,
				},
			});
			activityById.set(id, tracker.state);
			const record = manager.getRecord(id);
			if (!record) throw new Error("Managed agent record was not created");
			const completion = new Promise<AgentRecord>((resolve) => backgroundCompletions.set(id, resolve));
			return {
				id,
				completion,
				abort: () => manager.abort(id),
			};
		},
		async runFresh(ctx, request) {
			let id: string | undefined;
			let liveTokens = 0;
			let tokenCeilingReached = false;
			let compacted = false;
			const internalOwner = request.internalOwner ?? `managed:${request.type}`;
			const tracker = createActivityTracker(
				normalizeMaxTurns(request.maxTurns ?? request.agentConfig.maxTurns ?? getDefaultMaxTurns()),
				() => {
					widget.update();
					fleet.update();
				},
				request.onActivity,
			);
			const { record } = await manager.spawnAndWait(
				pi,
				ctx,
				request.type,
				request.prompt,
				{
					description: request.description,
					model: request.model ?? ctx.model,
					maxTurns: request.maxTurns,
					hardTurnLimit: request.hardTurnLimit ?? true,
					toolExecution: request.toolExecution,
					agentConfig: request.agentConfig,
					toolPolicy: request.toolPolicy,
					customTools: request.customTools,
					internalOwner,
					inheritContext: false,
					thinkingLevel: request.thinkingLevel,
					cwd: request.cwd,
					signal: request.signal,
					invocation: {
						modelName: request.model ? `${request.model.provider}/${request.model.id}` : undefined,
						thinking: request.thinkingLevel,
						maxTurns: request.maxTurns,
						isolated: false,
						inheritContext: false,
						advisor: false,
						runInBackground: false,
					},
					onToolActivity: tracker.callbacks.onToolActivity,
					onTextDelta: tracker.callbacks.onTextDelta,
					onTurnEnd: tracker.callbacks.onTurnEnd,
					onAssistantUsage: (usage) => {
						tracker.callbacks.onAssistantUsage(usage);
						request.onAssistantUsage?.(usage);
						liveTokens += usage.input + usage.output + usage.cacheWrite;
						if (request.maxTokens !== undefined && liveTokens >= request.maxTokens && id) {
							tokenCeilingReached = true;
							manager.abort(id, "token_ceiling");
						}
					},
					onCompaction: (info) => {
						compacted = true;
						request.onCompaction?.(info);
						if (id) manager.abort(id, "compaction");
					},
					onSessionCreated: tracker.callbacks.onSessionCreated,
					maxSubagentDepth: 0,
				},
				(agentId) => {
					id = agentId;
					activityById.set(agentId, tracker.state);
					request.onStarted?.(agentId);
				},
			);
			if (id) activityById.set(id, tracker.state);
			if (tokenCeilingReached) record.terminationCause = "token_ceiling";
			else if (compacted || record.compactionCount > 0) record.terminationCause = "compaction";
			else if (request.signal?.aborted) record.terminationCause = "external_cancellation";
			else if (record.status === "steered" || record.status === "aborted") record.terminationCause = "turn_ceiling";
			else if (record.status === "error") record.terminationCause = "provider_error";
			const session = record.session;
			record.session = undefined;
			await disposeAgentSession(session);
			return record;
		},
		abort(agentId) {
			return manager.abort(agentId);
		},
	};
	const uninstallManagedService = installManagedSubagentService(managedService, pi.events);

	const bindSessionContext = (ctx: { cwd: string; isProjectTrusted?: () => boolean }): SubagentConfigScope => {
		const scope = {
			cwd: ctx.cwd,
			projectTrusted: typeof ctx.isProjectTrusted === "function" ? ctx.isProjectTrusted() : false,
		};
		applyCompleteSettings(loadSettings(scope), {
			setMaxConcurrent: (value) => manager.setMaxConcurrent(value),
			setDefaultMaxTurns,
			setGraceTurns,
			setDefaultJoinMode: (value) => {
				defaultJoinMode = value;
			},
			setStrictAgentFiles: (value) => {
				strictAgentFiles = value;
			},
			setDisableDefaultAgents: setDefaultsDisabled,
			setFleetView: (value) => {
				fleetEnabled = value;
				fleet.setEnabled(value);
			},
			setPersistAgentSessions,
			setWidgetMode: (value) => {
				widgetMode = value;
				widget.update();
			},
			setMaxSubagentDepth,
		});
		reloadAgents(scope, strictAgentFiles);
		return scope;
	};

	pi.registerMessageRenderer<NotificationDetails>("subagent-notification", (message, { expanded }, theme) => {
		const all = message.details ? [message.details, ...(message.details.others ?? [])] : [];
		if (!all.length) return undefined;
		return new Text(
			all
				.map((details) => {
					const failed = ["error", "stopped", "aborted"].includes(details.status);
					const icon = failed ? theme.fg("error", "✗") : theme.fg("success", "✓");
					const stats = [
						details.turnCount ? formatTurns(details.turnCount, details.maxTurns) : "",
						details.toolUses ? `${details.toolUses} tool use${details.toolUses === 1 ? "" : "s"}` : "",
						details.totalTokens ? formatTokens(details.totalTokens) : "",
						details.durationMs ? formatMs(details.durationMs) : "",
					]
						.filter(Boolean)
						.join(" · ");
					const output = expanded ? details.resultPreview : details.resultPreview.split("\n")[0].slice(0, 100);
					return `${icon} ${theme.bold(details.description)} ${theme.fg("dim", details.status)}${stats ? `\n  ${theme.fg("dim", stats)}` : ""}\n  ${theme.fg("dim", `⎿  ${output}`)}`;
				})
				.join("\n"),
			0,
			0,
		);
	});

	pi.on("session_start", async (_event, ctx) => {
		bindSessionContext(ctx);
		manager.clearCompleted(true);
		if (ctx.hasUI) {
			widget.setUICtx(ctx.ui);
			fleet.setUICtx(ctx.ui as any);
			fleet.setEnabled(fleetEnabled);
		}
	});
	pi.on("tool_execution_start", async (_event, ctx) => {
		if (ctx.hasUI) {
			widget.setUICtx(ctx.ui);
			fleet.setUICtx(ctx.ui as any);
			widget.onTurnStart();
		}
	});
	const prepareSessionNavigation = () => {
		for (const record of manager.listAgents()) {
			if (record.status !== "running" && record.status !== "queued") continue;
			record.resultConsumed = true;
			lifecycleCancelledIds.add(record.id);
		}
		manager.abortAll();
		for (const timer of pendingNotifications.values()) clearTimeout(timer);
		pendingNotifications.clear();
		if (batchTimer) clearTimeout(batchTimer);
		batchTimer = undefined;
		currentBatch = [];
		groupJoin.dispose();
		widget.update();
		fleet.update();
	};
	pi.on("session_before_switch", prepareSessionNavigation);
	pi.on("session_before_fork", prepareSessionNavigation);
	pi.on("session_before_tree", prepareSessionNavigation);
	pi.on("session_tree", () => {
		for (const timer of pendingNotifications.values()) clearTimeout(timer);
		pendingNotifications.clear();
		manager.clearCompleted(false);
		activityById.clear();
		widget.update();
		fleet.update();
	});
	pi.on("session_shutdown", async () => {
		prepareSessionNavigation();
		uninstallManagedService();
		for (const timer of pendingNotifications.values()) clearTimeout(timer);
		pendingNotifications.clear();
		if (batchTimer) clearTimeout(batchTimer);
		groupJoin.dispose();
		widget.dispose();
		fleet.dispose();
		manager.dispose();
	});

	// Teach the root agent about its subagent team via the system prompt (mirrors
	// the ledger prompt append). The roster is rebuilt per turn from the freshly
	// bound registry so custom agent files and cwd changes are reflected; the tool
	// descriptions no longer carry a competing static list.
	pi.on("before_agent_start", (event, ctx) => {
		bindSessionContext(ctx);
		const members: TeamMember[] = getAvailableTypes().map((name) => toTeamMember(name, getAgentConfig(name)));
		return {
			systemPrompt: appendTeamSystemPrompt(event.systemPrompt ?? "", members, INFERENCE_PROFILE_CATALOG),
		};
	});

	const agentTool = defineTool({
		name: SUBAGENT_TOOL_NAMES.AGENT,
		label: "Agent",
		description: [
			"Launch an autonomous subagent in an isolated Pi context.",
			"Use background mode for parallel work, then get_subagent_result; use resume to continue an in-memory agent.",
			"Custom agents are Markdown files in .pi/agents, .agents/agents, or the Pi agent directory.",
			"Subagents may delegate only when their definition explicitly sets allowed_subagents.",
			`The live <${TEAM_SYSTEM_PROMPT_TAG}> system-prompt block lists every callable teammate with its name, configured inference profile, and own description. The separate <${INFERENCE_PROFILES_SYSTEM_PROMPT_TAG}> block lists the inference profiles and their descriptions. Select the teammate with subagent_type, optionally select an inference profile with profile, and append dynamic guidance with system_prompt without changing capabilities.`,
		].join(" "),
		promptGuidelines: [
			`The parent session is a senior engineer who may implement. In the live <${TEAM_SYSTEM_PROMPT_TAG}> block, choose a teammate by its own description and use its configured inference profile unless the invocation needs an explicit profile override. If no teammate fits, keep the work in the parent session.`,
			"Do not launch overlapping writers. Do not retry an unchanged rejected task.",
			`Use the Agent tool for collaboration and pi_exec agents.run for program graphs. Agent subagent_type and agents.run type select a teammate; profile selects an available inference profile. Pair profile with Agent's system_prompt or agents.run's systemPrompt for dynamic specialization. Additional guidance cannot grant capabilities.`,
			"The persistent Advisor reviews the root session. Implement runs its Advisor sidecar by default; set advisor false to explicitly opt out for one new session. Other types follow their agent-definition Advisor default.",
			"Agent definitions and trusted settings own safety ceilings. Use stop_subagent if a live run should be terminated.",
		],
		parameters: Type.Object({
			prompt: Type.String({ description: "Self-contained task for the agent." }),
			description: Type.String({ description: "Short task description shown in the UI." }),
			subagent_type: Type.String({ description: "Agent type from the available Markdown/default definitions." }),
			profile: Type.Optional(INFERENCE_PROFILE_PARAMETER_SCHEMA),
			system_prompt: Type.Optional(
				Type.String({
					minLength: 1,
					description:
						"Invocation-specific system guidance appended after the selected definition and preloaded skills. It cannot change capabilities and is fixed for the session.",
				}),
			),
			resume: Type.Optional(Type.String({ description: "Existing agent ID to continue." })),
			run_in_background: Type.Boolean({ default: false, description: "Run without waiting for completion." }),
			isolated: Type.Boolean({
				default: false,
				description: "Disable skill inheritance for a new agent session.",
			}),
			inherit_context: Type.Boolean({
				default: false,
				description: "Include the full parent conversation before the initial task prompt.",
			}),
			advisor: Type.Optional(
				Type.Boolean({
					description:
						"Override the agent definition's Advisor default. Omit to use the definition; false disables it when the definition enables it.",
				}),
			),
			cwd: Type.Optional(Type.String({ description: "Absolute working directory override." })),
		}),
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			bindSessionContext(ctx);

			if (params.resume) {
				const existing = manager.getRecord(params.resume);
				if (!existing || existing.parentAgentId || existing.internalOwner)
					return textResult(`Agent not found: ${params.resume}`, undefined, true);
				const requestedInheritance = params.inherit_context === true;
				const requestedAdvisor = params.advisor ?? existing.invocation?.advisor === true;
				const requestedIsolation = params.isolated === true;
				const requestedProfile = params.profile ?? existing.invocation?.profile;
				const requestedSystemPrompt = params.system_prompt?.trim() || existing.invocation?.systemPrompt;
				if (
					requestedInheritance !== (existing.invocation?.inheritContext === true) ||
					requestedAdvisor !== (existing.invocation?.advisor === true) ||
					requestedIsolation !== (existing.invocation?.isolated === true) ||
					requestedProfile !== existing.invocation?.profile ||
					requestedSystemPrompt !== existing.invocation?.systemPrompt
				) {
					return textResult(
						"profile, system_prompt, inherit_context, advisor, and isolated are fixed when an agent session starts; resume it with the original values or launch a new agent.",
						undefined,
						true,
					);
				}
				const background = params.run_in_background === true;
				const activity = createActivityTracker(
					normalizeMaxTurns(existing.invocation?.maxTurns ?? getDefaultMaxTurns()),
					() => widget.update(),
				);
				activityById.set(existing.id, activity.state);
				const resumed = await manager.resume(existing.id, params.prompt, background ? undefined : signal, {
					isBackground: background,
					onToolActivity: activity.callbacks.onToolActivity,
					onAssistantUsage: activity.callbacks.onAssistantUsage,
					onCompaction: () => widget.update(),
				});
				if (!resumed)
					return textResult(`Agent ${existing.id} is already running or cannot be resumed.`, undefined, true);
				if (background)
					return textResult(
						`Agent resumed in background. Agent ID: ${existing.id}\n\nCall get_subagent_result with this agent_id to wait for its final result.`,
						detailsFor(resumed, activity.state, { status: "background" }),
					);
				return textResult(
					`${resumed.result || resumed.error || "No output."}${continuationSuffix(resumed)}`,
					detailsFor(resumed, activity.state),
					resumed.status === "error",
				);
			}

			const dispatch = resolveSpawnType(params.subagent_type);
			if (!dispatch.ok) return textResult(dispatch.message, undefined, true);
			const type = dispatch.type;
			const config = getAgentConfig(type);
			if (!config) return textResult(`Unknown or disabled agent type: "${type}"`, undefined, true);
			const resolvedAgentProfile = resolveAgentProfile({
				registry: ctx.modelRegistry,
				parentModel: ctx.model,
				parentThinking: ctx.thinkingLevel,
				config,
				explicitProfile: params.profile,
			});
			if (resolvedAgentProfile.error) return textResult(resolvedAgentProfile.error, undefined, true);
			const invocation = resolveAgentInvocationConfig(config, params);
			const model = resolvedAgentProfile.model;
			const effectiveMaxTurns = normalizeMaxTurns(invocation.maxTurns ?? getDefaultMaxTurns());
			let id: string | undefined;
			const tracker = createActivityTracker(effectiveMaxTurns, () => {
				widget.update();
				fleet.update();
				if (id && onUpdate) {
					const record = manager.getRecord(id);
					if (record)
						onUpdate(
							textResult(
								tracker.state.responseText || "(running...)",
								detailsFor(record, tracker.state, {
									status: record.status,
									activity: describeActivity(tracker.state.activeTools, tracker.state.responseText),
									spinnerFrame: Math.floor(Date.now() / 80) % SPINNER.length,
								}),
							),
						);
				}
			});
			const modelName =
				model && ctx.model && (model.provider !== ctx.model.provider || model.id !== ctx.model.id)
					? model.id
					: undefined;
			const invocationDetails: AgentInvocation = {
				modelName,
				profile: resolvedAgentProfile.profile,
				systemPrompt: invocation.systemPrompt,
				thinking: resolvedAgentProfile.thinkingLevel,
				maxTurns: effectiveMaxTurns,
				isolated: invocation.isolated,
				inheritContext: invocation.inheritContext,
				advisor: invocation.advisor,
				runInBackground: invocation.runInBackground,
			};
			const options = {
				description: params.description,
				agentConfig: config,
				systemPrompt: invocation.systemPrompt,
				model,
				modelResolved: true,
				maxTurns: effectiveMaxTurns,
				isolated: invocation.isolated,
				inheritContext: invocation.inheritContext,
				advisor: invocation.advisor,
				thinkingLevel: resolvedAgentProfile.thinkingLevel,
				cwd: params.cwd,
				invocation: invocationDetails,
				onToolActivity: tracker.callbacks.onToolActivity,
				onTextDelta: tracker.callbacks.onTextDelta,
				onTurnEnd: tracker.callbacks.onTurnEnd,
				onAssistantUsage: tracker.callbacks.onAssistantUsage,
				onSessionCreated: tracker.callbacks.onSessionCreated,
				maxSubagentDepth: getMaxSubagentDepth(),
			};

			try {
				if (invocation.runInBackground) {
					id = manager.spawn(pi, ctx, type, params.prompt, { ...options, isBackground: true });
					activityById.set(id, tracker.state);
					const record = manager.getRecord(id)!;
					record.toolCallId = toolCallId;
					const joinMode = resolveJoinMode(defaultJoinMode, true)!;
					record.joinMode = joinMode;
					trackBatch(id, joinMode);
					return textResult(
						`Agent started in background. Agent ID: ${id}\n\nCall get_subagent_result with this agent_id to wait for its final result.`,
						detailsFor(record, tracker.state, { status: "background" }),
					);
				}
				const result = await manager.spawnAndWait(pi, ctx, type, params.prompt, { ...options, signal }, (agentId) => {
					id = agentId;
					activityById.set(agentId, tracker.state);
					const record = manager.getRecord(agentId);
					if (record) record.toolCallId = toolCallId;
				});
				const record = result.record;
				const output =
					(record.status === "error"
						? `Agent failed: ${record.error ?? "unknown error"}${partialOutputSuffix(record)}`
						: `${record.result || "No output."}${getForegroundOutcomeNote(record.status)}`) +
					continuationSuffix(record);
				return textResult(output, detailsFor(record, tracker.state), record.status === "error");
			} catch (error) {
				return textResult(error instanceof Error ? error.message : String(error), undefined, true);
			}
		},
		renderCall(args, theme) {
			const type = args.subagent_type || "agent";
			const suffix = args.run_in_background ? theme.fg("muted", " [background]") : "";
			return new Text(
				`${theme.fg("toolTitle", theme.bold("Agent "))}${renderAgentName(type, theme, { bold: true })}${suffix}\n  ${theme.fg("dim", args.description || args.prompt || "...")}`,
				0,
				0,
			);
		},
		renderResult(result, { expanded }, theme) {
			const details = result.details as AgentDetails | undefined;
			const content = result.content[0]?.type === "text" ? result.content[0].text : "(no output)";
			if (!details) return new Text(content, 0, 0);
			if (details.status === "running" || details.status === "queued" || details.status === "background") {
				const stats = [
					details.turnCount ? formatTurns(details.turnCount, details.maxTurns) : "",
					details.toolUses ? `${details.toolUses} tools` : "",
					details.tokens,
				]
					.filter(Boolean)
					.join(" · ");
				return renderRunningAgentStatus(
					SPINNER[details.spinnerFrame ?? 0],
					fgPreservingNestedStyles(theme, "dim", stats),
					details.activity || content,
					theme,
				);
			}
			const failed = ["error", "aborted", "stopped"].includes(details.status);
			const icon = failed ? theme.fg("error", "✗") : theme.fg("success", "✓");
			const container = new Container();
			container.addChild(
				new Text(
					`${icon} ${renderAgentName(details.subagentType, theme, { bold: true })} ${theme.fg("dim", `${details.toolUses} tools · ${details.tokens} · ${formatMs(details.durationMs)}`)}`,
					0,
					0,
				),
			);
			container.addChild(new Spacer(1));
			if (expanded) container.addChild(new Markdown(content, 0, 0, getMarkdownTheme()));
			else container.addChild(new Text(theme.fg("dim", `⎿  ${content.split("\n")[0].slice(0, 120)}`), 0, 0));
			return container;
		},
	});
	pi.registerTool(agentTool);

	pi.registerTool(
		defineTool({
			name: SUBAGENT_TOOL_NAMES.GET_RESULT,
			label: "Get Subagent Result",
			description:
				"Wait for a subagent result; omit yield_seconds to wait until it settles and receive its full final output. If an explicit yield is necessary, use a very large yield_seconds value (normally 3,600 seconds or more): this returns as soon as the agent finishes. yield_seconds is not an agent timeout; reaching it only yields control while the still-running agent continues untouched. Set it to 0 only for an immediate status check. Use transcript_tail for a bounded recent conversation slice or verbose for the full conversation; transcript_tail is mutually exclusive with verbose and a positive yield.",
			parameters: Type.Object({
				agent_id: Type.String(),
				yield_seconds: Type.Optional(
					Type.Number({
						minimum: 0,
						description:
							"Seconds to wait before yielding control, not an agent timeout. Omit to wait until settlement (or to take an immediate transcript_tail snapshot). If you set it, use a very large positive value (normally 3,600 seconds or more) because this call returns as soon as the agent settles; 0 only checks immediately. A yielded call leaves the queued or running agent working.",
					}),
				),
				verbose: Type.Boolean({
					default: false,
					description: "Append the full conversation transcript. Mutually exclusive with transcript_tail.",
				}),
				transcript_tail: Type.Optional(
					Type.Number({
						minimum: 1,
						maximum: 20,
						description:
							"Append up to 12,000 characters from the most recent N conversation messages, including current streaming output. Mutually exclusive with verbose.",
					}),
				),
			}),
			async execute(_toolCallId, params, signal) {
				let waitMode: ResultWaitMode;
				try {
					waitMode = resolveResultWaitMode(params.yield_seconds, params.transcript_tail !== undefined);
				} catch (error) {
					return textResult(error instanceof Error ? error.message : String(error), undefined, true);
				}
				if (params.transcript_tail !== undefined && (params.verbose || waitMode.kind === "yield")) {
					return textResult(
						"transcript_tail cannot be combined with verbose or a positive yield_seconds value.",
						undefined,
						true,
					);
				}
				const record = manager.getRecord(params.agent_id);
				if (!record || record.parentAgentId || record.internalOwner)
					return textResult(`Agent not found: ${params.agent_id}`, undefined, true);
				let yieldedSeconds: number | undefined;
				if (waitMode.kind !== "immediate" && (record.status === "queued" || record.status === "running")) {
					const outcome = await waitForAgentSettlement(record, waitMode, signal);
					if (outcome === "yielded" && waitMode.kind === "yield") yieldedSeconds = waitMode.seconds;
				}
				const settled = record.status !== "queued" && record.status !== "running";
				if (settled && params.transcript_tail === undefined) {
					record.resultConsumed = true;
					cancelNotification(record.id);
				}
				let output =
					!settled || params.transcript_tail !== undefined
						? `Agent ${record.id} is ${record.status}.`
						: record.result || record.error || "No output.";
				if (yieldedSeconds !== undefined && !settled) {
					output += ` Yield interval (${yieldedSeconds}s) reached; the agent is still working in the background and was not stopped. Call get_subagent_result again only when you need another check-in.`;
				}
				if ((params.verbose || params.transcript_tail !== undefined) && record.session) {
					const tail =
						params.transcript_tail === undefined
							? undefined
							: Math.min(20, Math.max(1, Math.floor(params.transcript_tail)));
					const transcript = getAgentConversation(record.session, tail) || "(no conversation messages yet)";
					const heading = tail === undefined ? "Conversation" : `Recent conversation (last ${tail} messages)`;
					output += `\n\n--- ${heading} ---\n${transcript}`;
				}
				return textResult(output, detailsFor(record, activityById.get(record.id)), record.status === "error");
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: SUBAGENT_TOOL_NAMES.STEER,
			label: "Steer Subagent",
			description: "Send guidance to a running or queued subagent by ID.",
			parameters: Type.Object({ agent_id: Type.String(), message: Type.String() }),
			async execute(_toolCallId, params) {
				if (!manager.steer(params.agent_id, params.message))
					return textResult(`Running agent not found: ${params.agent_id}`, undefined, true);
				pi.events.emit("subagents:steered", { id: params.agent_id, message: params.message });
				return textResult(`Steering message sent to agent ${params.agent_id}.`);
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: SUBAGENT_TOOL_NAMES.STOP,
			label: "Stop Subagent",
			description: "Stop a running or queued subagent by ID.",
			parameters: Type.Object({ agent_id: Type.String() }),
			async execute(_toolCallId, params) {
				const record = manager.getRecord(params.agent_id);
				if (
					!record ||
					record.parentAgentId ||
					record.internalOwner ||
					(record.status !== "running" && record.status !== "queued")
				) {
					return textResult(`Running or queued agent not found: ${params.agent_id}`, undefined, true);
				}
				// A queued abort completes synchronously, so suppress its completion nudge
				// before manager.abort() runs the shared lifecycle callback.
				record.resultConsumed = true;
				if (!manager.abort(params.agent_id)) {
					record.resultConsumed = false;
					return textResult(`Running or queued agent not found: ${params.agent_id}`, undefined, true);
				}
				cancelNotification(record.id);
				return textResult(`Stopped subagent ${record.id}.`);
			},
		}),
	);

	async function openConversation(ctx: ExtensionCommandContext, record: AgentRecord): Promise<void> {
		if (!record.session || !ctx.hasUI) return;
		await ctx.ui.custom<undefined>(
			(tui, theme, keybindings, done) =>
				new ConversationViewer(
					tui,
					record.session!,
					record,
					activityById.get(record.id),
					theme,
					done,
					() => manager.abort(record.id),
					keybindings,
					(message) => manager.steer(record.id, message),
				),
			{ overlay: true, overlayOptions: { anchor: "center", width: "90%", maxHeight: `${VIEWPORT_HEIGHT_PCT}%` } },
		);
	}

	pi.registerCommand("agents", {
		description: "View live subagents and discovered Markdown agent types",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;
			bindSessionContext(ctx);
			const records = manager.listAgents().filter((record) => !record.parentAgentId && !record.internalOwner);
			const choices = [
				...records.map(
					(record) =>
						`${record.status === "running" ? "●" : "○"} ${record.description} · ${record.type} · ${record.id}`,
				),
				"Agent types",
			];
			const selected = await ctx.ui.select("Subagents", choices);
			if (!selected) return;
			if (selected === "Agent types") {
				const types = getAvailableTypes();
				const type = await ctx.ui.select("Agent types", types);
				if (!type) return;
				const config = getAgentConfig(type);
				ctx.ui.notify(`${config?.description ?? type}${config?.sourcePath ? `\n${config.sourcePath}` : ""}`, "info");
				return;
			}
			const index = choices.indexOf(selected);
			const record = records[index];
			if (record) await openConversation(ctx, record);
		},
	});
}
