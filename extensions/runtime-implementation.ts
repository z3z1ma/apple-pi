import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { Usage } from "@earendil-works/pi-ai";
import {
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	defineTool,
	type ExtensionAPI,
	type ExtensionContext,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { loadSearchRootGuardConfig } from "../components/home-search-guard/src/config.js";
import { searchRootBlockReason } from "../components/home-search-guard/src/index.js";
import {
	PROGRAM_ENVELOPE_MAXIMA,
	type ProgramEnvelope,
	type ProgramEnvelopeLimits,
} from "../components/shared/src/runtime-envelope.js";
import { createExecBashToolDefinition } from "../components/tasks/src/bash-tool.js";
import {
	agentOperationArgs,
	PI_EXEC_RETURN_TOOL,
	parseAgentRequest,
	prepareAgentSpawn,
	resolveExecWorker,
	resolveStructuredOutput,
} from "./runtime-agent.js";
import {
	attachLiveDescription,
	guestPythonStubs,
	PI_EXEC_DISPLAY_PARAMETER_DESCRIPTION,
	PI_EXEC_PROMPT_GUIDELINES,
	PI_EXEC_PROMPT_SNIPPET,
	piExecGuestApiContract,
	piExecToolDescription,
} from "./runtime-api.js";
import { sealCheckpoint, verifyCheckpoint } from "./runtime-checkpoint.js";
import { containsContextMarks, EVIDENCE_FUNCTION_NAMES, fitContext, runEvidenceFunction } from "./runtime-evidence.js";
import { serializeJsonValue } from "./runtime-json.js";
import {
	buildProgramParametersSchema,
	listSavedPrograms,
	readSavedProgram,
	SAVED_PROGRAM_PROMPT_GUIDELINE,
	savedProgramToolName,
} from "./runtime-saved-programs.js";
import { listSkills, readSkillBody } from "./runtime-skills.js";
import { capturedTool, capturedTools, installRegisteredToolCapture } from "./runtime-tools.js";
import type { ExecutionOperation, ProgramHostCall, WorkerResult } from "./runtime-types.js";
import { type ExecActivitySnapshot, ExecActivityWidget, renderExecCall, renderExecResult } from "./runtime-ui.js";

export {
	PROGRAM_ENVELOPE_MAXIMA,
	type ProgramEnvelope,
	type ProgramEnvelopeLimits,
} from "../components/shared/src/runtime-envelope.js";
export type {
	ExecutionOperation,
	ExecutionOutcome,
	ProgramExecution,
	ProgramHostCall,
	WorkerResult,
} from "./runtime-types.js";

const MAX_GUEST_TOOL_RESULT_CHARS = 50_000;
const MAX_TRACE_RESULT_CHARS = 4_000;
const DEFAULT_CALL_BUDGET = 128;
const DEFAULT_CONCURRENCY = 16;
const DEFAULT_AGENT_BUDGET = 8;

function clampLimit(value: number | undefined, fallback: number, min: number, max: number): number {
	if (value === undefined || !Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(min, Math.trunc(value)));
}

/** Default envelope from program shape. Optional limits scale capacity up to package maxima. */
export function deriveProgramEnvelope(code: string, limits: ProgramEnvelopeLimits = {}): ProgramEnvelope {
	const hasWorkers = /\bagent(?:_run)?\s*\(/.test(code);
	const hasFanout = /\basyncio\.gather\s*\(/.test(code);
	const callBudget = Math.min(DEFAULT_CALL_BUDGET, Math.max(64, 64 + Math.ceil(Buffer.byteLength(code) / 2_048) * 8));
	const derived: ProgramEnvelope = {
		callBudget,
		concurrency: hasFanout ? DEFAULT_CONCURRENCY : Math.min(8, DEFAULT_CONCURRENCY),
		agentBudget: DEFAULT_AGENT_BUDGET,
		memoryMb: PROGRAM_ENVELOPE_MAXIMA.memoryMb,
		timeoutSeconds: hasWorkers ? 600 : 300,
	};
	return {
		callBudget: clampLimit(limits.callBudget, derived.callBudget, 1, PROGRAM_ENVELOPE_MAXIMA.callBudget),
		concurrency: clampLimit(limits.concurrency, derived.concurrency, 1, PROGRAM_ENVELOPE_MAXIMA.concurrency),
		agentBudget: clampLimit(limits.agentBudget, derived.agentBudget, 1, PROGRAM_ENVELOPE_MAXIMA.agentBudget),
		memoryMb: derived.memoryMb,
		timeoutSeconds: clampLimit(
			limits.timeoutSeconds,
			derived.timeoutSeconds,
			1,
			PROGRAM_ENVELOPE_MAXIMA.timeoutSeconds,
		),
	};
}
const CORE_TOOL_LIST = ["read", "grep", "find", "ls", "bash", "edit", "write"] as const;
const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const EXEC_WIDGET_ID = "apple-pi:exec-activity";
const CORE_TOOL_NAMES = new Set<string>(CORE_TOOL_LIST);
const ENVELOPE_TOOLS = new Set(["bash", "edit", "write"]);
const MONTY_ENTRY_TYPE = "apple-pi:monty-session";
const ROLLBACK_NOTICE =
	"Monty state was rolled back to the last saved checkpoint. Completed tool, file, and process effects were not undone.";

function branchCheckpoint(ctx: ExtensionContext): { found: boolean; data?: unknown } {
	const branch = ctx.sessionManager.getBranch();
	for (let index = branch.length - 1; index >= 0; index--) {
		const entry = branch[index]!;
		if (entry.type === "custom" && entry.customType === MONTY_ENTRY_TYPE) return { found: true, data: entry.data };
	}
	return { found: false };
}

export const aggregateUsage = (usages: Usage[]): Usage => ({
	input: usages.reduce((total, usage) => total + usage.input, 0),
	output: usages.reduce((total, usage) => total + usage.output, 0),
	cacheRead: usages.reduce((total, usage) => total + usage.cacheRead, 0),
	cacheWrite: usages.reduce((total, usage) => total + usage.cacheWrite, 0),
	...(usages.some((usage) => usage.cacheWrite1h !== undefined)
		? { cacheWrite1h: usages.reduce((total, usage) => total + (usage.cacheWrite1h ?? 0), 0) }
		: {}),
	...(usages.some((usage) => usage.reasoning !== undefined)
		? { reasoning: usages.reduce((total, usage) => total + (usage.reasoning ?? 0), 0) }
		: {}),
	totalTokens: usages.reduce((total, usage) => total + usage.totalTokens, 0),
	cost: {
		input: usages.reduce((total, usage) => total + usage.cost.input, 0),
		output: usages.reduce((total, usage) => total + usage.cost.output, 0),
		cacheRead: usages.reduce((total, usage) => total + usage.cost.cacheRead, 0),
		cacheWrite: usages.reduce((total, usage) => total + usage.cost.cacheWrite, 0),
		total: usages.reduce((total, usage) => total + usage.cost.total, 0),
	},
});

type CoreDefinitions = Record<string, ToolDefinition<any, any>>;
const toolDefinitions = new Map<string, CoreDefinitions>();

function definitionsFor(cwd: string): CoreDefinitions {
	let definitions = toolDefinitions.get(cwd);
	if (!definitions) {
		definitions = {
			read: createReadToolDefinition(cwd),
			grep: createGrepToolDefinition(cwd),
			find: createFindToolDefinition(cwd),
			ls: createLsToolDefinition(cwd),
			bash: createExecBashToolDefinition(cwd),
			edit: createEditToolDefinition(cwd),
			write: createWriteToolDefinition(cwd),
		};
		toolDefinitions.set(cwd, definitions);
	}
	return definitions;
}

function invocation(): { command: string; prefix: string[] } {
	const script = process.argv[1];
	if (script && !script.startsWith("/$bunfs/root/") && existsSync(script)) {
		return { command: process.execPath, prefix: [script] };
	}
	const executable = basename(process.execPath).toLowerCase();
	if (!/^(node|bun)(\.exe)?$/.test(executable)) {
		return { command: process.execPath, prefix: [] };
	}
	return { command: "pi", prefix: [] };
}

function textFromAssistant(message: any): string {
	if (message?.role !== "assistant" || !Array.isArray(message.content)) return "";
	return message.content
		.filter((part: any) => part?.type === "text" && typeof part.text === "string")
		.map((part: any) => part.text)
		.join("\n");
}

function bounded(value: string, max: number, marker: string): { value: string; truncated: boolean } {
	if (value.length <= max) return { value, truncated: false };
	return {
		value: `${value.slice(0, max)}\n\n[${marker}: truncated from ${value.length.toLocaleString()} characters]`,
		truncated: true,
	};
}

async function runAgent(
	index: number,
	request: ReturnType<typeof parseAgentRequest>,
	ctx: ExtensionContext,
	signal: AbortSignal | undefined,
	onActivity?: (activity: string) => void,
): Promise<WorkerResult> {
	const projectTrusted = typeof ctx.isProjectTrusted === "function" ? ctx.isProjectTrusted() : false;
	const resolved = await resolveExecWorker(request, {
		cwd: ctx.cwd,
		parentModel: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
		parentThinking: ctx.thinkingLevel,
		projectTrusted,
		registry: ctx.modelRegistry,
		parentModelObject: ctx.model,
	});
	if (resolved.tools.some((tool) => !CORE_TOOL_NAMES.has(tool))) {
		throw new Error(`Agent tools must be selected from: ${CORE_TOOL_LIST.join(", ")}`);
	}
	if (resolved.thinking && !THINKING_LEVELS.has(resolved.thinking)) {
		throw new Error(`Agent thinking must be one of: ${[...THINKING_LEVELS].join(", ")}`);
	}
	const prepared = prepareAgentSpawn(
		{ ...request, ...(resolved.systemPrompt ? { systemPrompt: resolved.systemPrompt } : {}) },
		{
			tools: resolved.tools,
			projectTrusted,
			...(resolved.model ? { model: resolved.model } : {}),
			...(resolved.thinking ? { thinking: resolved.thinking } : {}),
			...(resolved.pair ? { pair: true } : {}),
		},
	);

	const pi = invocation();
	try {
		return await new Promise((resolve) => {
			const child = spawn(pi.command, [...pi.prefix, ...prepared.args], {
				cwd: ctx.cwd,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
				...(prepared.env ? { env: { ...process.env, ...prepared.env } } : {}),
			});
			let stdout = "";
			let stderr = "";
			let buffered = "";
			let stopReason: string | undefined;
			let error: string | undefined;
			const usages: Usage[] = [];
			const operations: ExecutionOperation[] = [];
			const operationByCallId = new Map<string, ExecutionOperation>();
			let aborted = false;
			let pendingReturn: unknown;
			let acceptedReturn: unknown;

			// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one JSON event decoder owns child-process operation correlation.
			const consume = (line: string) => {
				if (!line.trim()) return;
				try {
					const event = JSON.parse(line);
					if (event.type === "tool_execution_start") {
						onActivity?.(`using ${String(event.toolName ?? "tool")}`);
						if (event.toolName === PI_EXEC_RETURN_TOOL) pendingReturn = event.args;
						return;
					}
					if (event.type === "tool_execution_end") {
						if (event.toolName === PI_EXEC_RETURN_TOOL) {
							if (event.isError) pendingReturn = undefined;
							else acceptedReturn = pendingReturn;
						}
						return;
					}
					if (event.type === "message_start" && event.message?.role === "assistant") {
						onActivity?.("thinking");
						return;
					}
					if (event.type !== "message_end" || !event.message) return;
					const text = textFromAssistant(event.message);
					if (text) stdout = text;
					if (event.message.role === "assistant") {
						stopReason = event.message.stopReason;
						if (event.message.usage) usages.push(event.message.usage as Usage);
						if (typeof event.message.errorMessage === "string") error = event.message.errorMessage;
						if (Array.isArray(event.message.content)) {
							for (const part of event.message.content) {
								if (part?.type !== "toolCall" || typeof part.name !== "string") continue;
								const operation: ExecutionOperation = {
									sequence: operations.length,
									ref: part.name === PI_EXEC_RETURN_TOOL ? PI_EXEC_RETURN_TOOL : `pi.${part.name}`,
									args: part.arguments && typeof part.arguments === "object" ? part.arguments : {},
									outcome: "aborted",
								};
								operations.push(operation);
								if (typeof part.id === "string") operationByCallId.set(part.id, operation);
							}
						}
						onActivity?.(event.message.stopReason === "toolUse" ? "using tools" : "finishing");
					} else if (event.message.role === "toolResult") {
						const operation = operationByCallId.get(event.message.toolCallId);
						if (operation) {
							operation.outcome = event.message.isError ? "failed" : "succeeded";
							operation.result = traceValue(resultText(event.message));
							if (event.message.isError) operation.error = resultText(event.message).slice(0, 500);
						}
					}
				} catch {
					// Pi JSON mode is line-delimited; diagnostics remain on stderr.
				}
			};

			child.stdout.on("data", (chunk) => {
				buffered += chunk.toString();
				const lines = buffered.split("\n");
				buffered = lines.pop() ?? "";
				for (const line of lines) consume(line);
			});
			child.stderr.on("data", (chunk) => {
				stderr += chunk.toString();
			});

			const abort = () => {
				aborted = true;
				child.kill("SIGTERM");
			};
			if (signal?.aborted) abort();
			else signal?.addEventListener("abort", abort, { once: true });

			child.on("error", (cause) => {
				error = cause.message;
			});
			child.on("close", (code) => {
				signal?.removeEventListener("abort", abort);
				if (buffered.trim()) consume(buffered);
				const exitCode = code ?? 1;
				if (aborted) error = "Agent aborted";
				if (!error && exitCode !== 0) error = stderr.trim() || `Agent exited with code ${exitCode}`;
				if (!error && stopReason && ["error", "aborted"].includes(stopReason)) {
					error = stderr.trim() || `Agent stopped with ${stopReason}`;
				}
				const structured = resolveStructuredOutput(request.outputSchema, acceptedReturn);
				if (!error && structured.error) error = structured.error;
				const output =
					structured.value !== undefined && !error
						? JSON.stringify(structured.value)
						: stdout || error || "(agent returned no text)";
				resolve({
					index,
					task: request.task,
					output,
					exitCode,
					stopReason,
					error,
					...(structured.value !== undefined && !error ? { value: structured.value } : {}),
					...(usages.length > 0 ? { usage: aggregateUsage(usages) } : {}),
					operations,
				});
			});
		});
	} finally {
		prepared.cleanup();
	}
}

import { createProgramSession, executeProgram } from "./runtime-program.js";

export { executeProgram } from "./runtime-program.js";
export { listSkills, packagedSkillPaths, readSkillBody } from "./runtime-skills.js";

import { executeFetch, fetchOperationArgs, traceFetchUrl } from "./runtime-fetch.js";

function resultText(result: any): string {
	if (!Array.isArray(result?.content)) return "";
	return result.content
		.map((part: any) => (part?.type === "text" ? String(part.text ?? "") : `[${part?.mimeType ?? "image"}]`))
		.join("\n");
}

function traceValue(value: unknown): unknown {
	if (typeof value === "string") return bounded(value, MAX_TRACE_RESULT_CHARS, "trace result").value;
	try {
		const json = JSON.stringify(value);
		if (json && json.length > MAX_TRACE_RESULT_CHARS) {
			return bounded(json, MAX_TRACE_RESULT_CHARS, "trace result").value;
		}
		return value;
	} catch {
		return String(value);
	}
}

function portableValue(value: unknown, maxChars = MAX_GUEST_TOOL_RESULT_CHARS): unknown {
	if (value === undefined) return undefined;
	const json = serializeJsonValue(value, "pi_exec host result");
	if (json.length <= maxChars) return JSON.parse(json) as unknown;
	return {
		truncated: true,
		originalChars: json.length,
		preview: json.slice(0, maxChars),
	};
}

/** TypeBox schemas carry runtime metadata; the guest receives their JSON Schema projection. */
function portableSchema(value: unknown): unknown {
	const json = JSON.stringify(value);
	if (json === undefined) return undefined;
	return JSON.parse(json) as unknown;
}

function displayValue(value: unknown): string {
	if (typeof value === "string") return value;
	if (value === undefined) return "(program returned no value)";
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

export function isOwnedMontyWorker(pid: number | undefined): boolean {
	if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return false;
	if (process.platform === "win32") {
		try {
			const tasklist = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tasklist.exe");
			const output = execFileSync(tasklist, ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
				timeout: 1_000,
			}).trim();
			return output.toLowerCase().includes("monty.exe");
		} catch {
			return false;
		}
	}
	try {
		const output = execFileSync("ps", ["-p", String(pid), "-o", "ppid=,command="], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
			timeout: 1_000,
		}).trim();
		const [ppidStr, ...rest] = output.split(/\s+/);
		const ppid = Number(ppidStr);
		const command = rest.join(" ");
		return ppid === process.pid && command.includes("monty") && command.includes("subprocess");
	} catch {
		return false;
	}
}

export default function runtime(pi: ExtensionAPI): void {
	let captureError: string | undefined;
	try {
		installRegisteredToolCapture();
	} catch (error) {
		captureError = error instanceof Error ? error.message : String(error);
	}
	const failedDetails = new Map<string, { details: unknown; usage?: Usage }>();
	let owner: Awaited<ReturnType<typeof createProgramSession>> | undefined;
	let ownerHash: string | undefined;
	let hostCalls = 0;
	let selected: ReturnType<typeof branchCheckpoint> | undefined;
	let notice: string | undefined;
	let generation = 0;
	let executing = false;
	let activeAbort: AbortController | undefined;
	const stopWorker = (live: Awaited<ReturnType<typeof createProgramSession>>, pid: number | undefined) => {
		if (pid === undefined || live.session.workerPid !== undefined) return;
		if (!isOwnedMontyWorker(pid)) return;
		try {
			process.kill(pid, "SIGKILL");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ESRCH")
				console.error("pi_exec could not stop Monty worker", error);
		}
	};
	const discard = async () => {
		generation++;
		activeAbort?.abort();
		const previous = owner;
		owner = undefined;
		ownerHash = undefined;
		hostCalls = 0;
		if (previous) await previous.close().catch((error) => console.error("pi_exec Monty cleanup failed", error));
	};
	const selectBranch = async (ctx: ExtensionContext) => {
		await discard();
		selected = branchCheckpoint(ctx);
		notice = undefined;
	};
	pi.on("session_start", (_event, ctx) => selectBranch(ctx));
	pi.on("session_tree", (_event, ctx) => selectBranch(ctx));
	pi.on("session_shutdown", async () => {
		await discard();
		selected = undefined;
	});
	const ensureOwner = async (ctx: ExtensionContext) => {
		if (owner) return owner;
		const stubs = guestPythonStubs(ctx.cwd);
		const hash = createHash("sha256").update(stubs).digest("hex");
		const checkpoint = selected ?? branchCheckpoint(ctx);
		selected = undefined;
		if (checkpoint.found) {
			const dump = await verifyCheckpoint(ctx.sessionManager, checkpoint.data, hash);
			if (dump) {
				try {
					owner = await createProgramSession(stubs, dump);
					ownerHash = hash;
					return owner;
				} catch (error) {
					notice = `Monty checkpoint could not be loaded; started an empty session: ${error instanceof Error ? error.message : String(error)}`;
				}
			} else {
				notice = "Monty checkpoint is incompatible or unverifiable; started an empty session.";
			}
		}
		owner = await createProgramSession(stubs);
		ownerHash = hash;
		return owner;
	};
	const appendCheckpoint = async (
		ctx: ExtensionContext,
		live: Awaited<ReturnType<typeof createProgramSession>>,
		expectedGeneration: number,
	) => {
		const dump = await live.session.dump();
		const checkpoint = await sealCheckpoint(ctx.sessionManager, dump, ownerHash!);
		if (generation !== expectedGeneration || owner !== live)
			throw new Error("pi_exec session changed during checkpoint");
		pi.appendEntry(MONTY_ENTRY_TYPE, checkpoint);
	};
	pi.on("tool_result", (event) => {
		if ((event.toolName !== "pi_exec" && !event.toolName.startsWith("program_")) || !event.isError) return;
		const failure = failedDetails.get(event.toolCallId);
		if (!failure) return;
		failedDetails.delete(event.toolCallId);
		return failure;
	});

	const piExecTool = defineTool({
		name: "pi_exec",
		label: "Pi Exec",
		executionMode: "sequential",
		get description() {
			return piExecToolDescription();
		},
		promptSnippet: PI_EXEC_PROMPT_SNIPPET,
		promptGuidelines: [...PI_EXEC_PROMPT_GUIDELINES, SAVED_PROGRAM_PROMPT_GUIDELINE],
		parameters: Type.Object({
			code: attachLiveDescription(Type.String({ minLength: 1, maxLength: 100_000 }), piExecGuestApiContract),
			inputs: Type.Optional(
				Type.Record(Type.String(), Type.String({ maxLength: 200_000 }), {
					description: "Named strings available to the program as inputs.<key>.",
				}),
			),
			reset: Type.Optional(
				Type.Boolean({ description: "Start a fresh Monty session on this branch before running the snippet." }),
			),
			display: Type.Optional(
				Type.Object(
					{
						name: Type.Optional(Type.String({ maxLength: 120, description: "Concise program milestone." })),
						description: Type.Optional(
							Type.String({ maxLength: 300, description: "Program objective or acceptance criterion." }),
						),
					},
					{ description: PI_EXEC_DISPLAY_PARAMETER_DESCRIPTION },
				),
			),
			limits: Type.Optional(
				Type.Object(
					{
						agentBudget: Type.Optional(
							Type.Integer({
								minimum: 1,
								maximum: PROGRAM_ENVELOPE_MAXIMA.agentBudget,
								description: "Max nested agent() / agent.run workers for this program.",
							}),
						),
						callBudget: Type.Optional(
							Type.Integer({
								minimum: 1,
								maximum: PROGRAM_ENVELOPE_MAXIMA.callBudget,
								description: "Max host calls (tools, fetch, agents) for this program.",
							}),
						),
						concurrency: Type.Optional(
							Type.Integer({
								minimum: 1,
								maximum: PROGRAM_ENVELOPE_MAXIMA.concurrency,
								description: "Max in-flight host calls. Excess work queues.",
							}),
						),
						timeoutSeconds: Type.Optional(
							Type.Integer({
								minimum: 1,
								maximum: PROGRAM_ENVELOPE_MAXIMA.timeoutSeconds,
								description: "Wall-clock seconds before the program is stopped.",
							}),
						),
					},
					{
						description:
							"Optional capacity for this program. Omitted fields keep the shape-derived default. Values clamp to package maxima.",
					},
				),
			),
		}),
		renderCall(args, theme, context) {
			return renderExecCall(args, theme, context);
		},
		renderResult(result, options, theme, context) {
			return renderExecResult(result as any, options, theme, context);
		},
		// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: invocation-local Monty ownership shares budgets, cancellation, rollback, traces, and activity lifecycle.
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			if (executing) throw new Error("pi_exec already has a running program in this session");
			executing = true;
			const startedAt = Date.now();
			const envelope = deriveProgramEnvelope(params.code, params.limits);
			const { callBudget, concurrency, agentBudget } = envelope;
			const programName = params.display?.name?.trim() || "Program";
			const operations: ExecutionOperation[] = [];
			const pendingOperations = new Set<ExecutionOperation>();
			const activeOperations = new Set<ExecutionOperation>();
			const logs: string[] = [];
			const nestedUsages: Usage[] = [];
			let calls = 0;
			let active = 0;
			let agentCalls = 0;
			let finishedAt: number | undefined;
			let widget: ExecActivityWidget | undefined;
			let widgetMounted = false;
			const waiters: Array<() => void> = [];
			const acquire = async (runtimeSignal: AbortSignal): Promise<void> => {
				if (active < concurrency) {
					active++;
					return;
				}
				await new Promise<void>((resolve, reject) => {
					const grant = () => {
						runtimeSignal.removeEventListener("abort", abort);
						active++;
						resolve();
					};
					const abort = () => {
						const index = waiters.indexOf(grant);
						if (index >= 0) waiters.splice(index, 1);
						reject(new Error("pi_exec aborted while waiting for a call slot"));
					};
					waiters.push(grant);
					runtimeSignal.addEventListener("abort", abort, { once: true });
					if (runtimeSignal.aborted) abort();
				});
			};
			const release = () => {
				active--;
				waiters.shift()?.();
			};
			const activity = (): ExecActivitySnapshot => ({
				name: programName,
				...(params.display?.description ? { description: params.display.description } : {}),
				startedAt,
				...(finishedAt !== undefined ? { finishedAt } : {}),
				calls: operations.map((operation) => ({
					sequence: operation.sequence,
					ref: operation.ref,
					args: operation.args,
					status: activeOperations.has(operation)
						? "running"
						: pendingOperations.has(operation)
							? "queued"
							: operation.outcome,
					...(operation.activity ? { activity: operation.activity } : {}),
					...(operation.result !== undefined ? { result: operation.result } : {}),
					...(operation.error ? { error: operation.error } : {}),
				})),
			});
			const emit = () => {
				if (finishedAt !== undefined) return;
				const completed = operations.filter((operation) => !pendingOperations.has(operation));
				widget?.refresh();
				onUpdate?.({
					content: [{ type: "text", text: `pi_exec: ${completed.length} of ${calls} calls completed` }],
					details: {
						trace: { kind: "apple-pi.execution", version: 1, outcome: "succeeded", operations: completed },
						activity: activity(),
					},
				});
			};

			if (ctx.hasUI && ctx.mode === "tui") {
				try {
					ctx.ui.setWidget(
						EXEC_WIDGET_ID,
						(tui, theme) => {
							widget = new ExecActivityWidget(theme, activity, () => tui.requestRender());
							return widget;
						},
						{ placement: "aboveEditor" },
					);
					widgetMounted = true;
				} catch (error) {
					ctx.ui.notify(
						`pi_exec activity widget unavailable: ${error instanceof Error ? error.message : String(error)}`,
						"warning",
					);
				}
			}

			const availableExtensionTools = () => {
				if (captureError) throw new Error(`extension tools unavailable: ${captureError}`);
				const tools = capturedTools();
				if (tools.length === 0) {
					throw new Error("extension tools unavailable: Pi's registered-tool catalog was not captured");
				}
				return tools;
			};
			const invokeDefinition = async (
				definition: ToolDefinition<any, any>,
				args: Record<string, unknown>,
				operation: ExecutionOperation,
				runtimeSignal: AbortSignal,
			) => {
				const prepared = definition.prepareArguments ? definition.prepareArguments(args) : args;
				if (!Value.Check(definition.parameters, prepared)) {
					const issues = [...Value.Errors(definition.parameters, prepared)]
						.slice(0, 3)
						.map((issue) => `${issue.instancePath || "/"}: ${issue.message}`)
						.join("; ");
					throw new Error(`Invalid ${operation.ref} arguments: ${issues}`);
				}
				const result = await definition.execute(
					`${toolCallId}_nested_${operation.sequence + 1}`,
					prepared as any,
					runtimeSignal,
					(partial) => {
						const progress = resultText(partial).split("\n").find(Boolean);
						operation.activity = progress?.slice(0, 120) || "running";
						emit();
					},
					ctx,
				);
				if (result.usage) nestedUsages.push(result.usage);
				return result;
			};

			// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: invocation-local dispatch shares limits, cancellation, traces, usage, and widget cleanup.
			const hostCall: ProgramHostCall = async (ref, rawArgs, runtimeSignal) => {
				calls++;
				if (calls > callBudget) throw new Error(`pi_exec call budget exhausted (${callBudget})`);
				const operation: ExecutionOperation = {
					sequence: calls - 1,
					ref,
					args:
						ref === "fetch"
							? fetchOperationArgs(rawArgs)
							: ref === "agent.run"
								? agentOperationArgs(rawArgs)
								: ref.startsWith("evidence.context_")
									? Object.fromEntries(
											Object.entries(rawArgs).map(([key, value]) => [
												key,
												key === "value" || key === "items" ? { bound: true } : value,
											]),
										)
									: rawArgs,
					outcome: "succeeded",
				};
				operations.push(operation);
				operations.sort((left, right) => left.sequence - right.sequence);
				pendingOperations.add(operation);
				emit();
				let acquired = false;
				try {
					await acquire(runtimeSignal);
					acquired = true;
					activeOperations.add(operation);
					emit();
					let value: unknown;
					if (ref === "fetch") {
						value = await executeFetch(rawArgs, runtimeSignal);
					} else if (
						ref.startsWith("evidence.") &&
						EVIDENCE_FUNCTION_NAMES.includes(ref.slice(9) as (typeof EVIDENCE_FUNCTION_NAMES)[number])
					) {
						value = await runEvidenceFunction(ref.slice(9), rawArgs, { cwd: ctx.cwd, signal: runtimeSignal });
					} else if (ref === "tools.list" || ref === "tools.search" || ref === "tools.describe") {
						const tools = availableExtensionTools();
						const query = typeof rawArgs.query === "string" ? rawArgs.query.toLowerCase() : "";
						const name = typeof rawArgs.name === "string" ? rawArgs.name : "";
						const descriptors = tools.map((tool) => ({
							name: tool.name,
							description: tool.description,
							...(ref === "tools.describe" ? { parameters: portableSchema(tool.parameters) } : {}),
						}));
						value =
							ref === "tools.search"
								? descriptors.filter((tool) => `${tool.name} ${tool.description}`.toLowerCase().includes(query))
								: ref === "tools.describe"
									? descriptors.find((tool) => tool.name === name)
									: descriptors;
					} else if (ref === "tools.call") {
						availableExtensionTools();
						const name = typeof rawArgs.name === "string" ? rawArgs.name : "";
						const args =
							rawArgs.args && typeof rawArgs.args === "object" && !Array.isArray(rawArgs.args)
								? (rawArgs.args as Record<string, unknown>)
								: {};
						const tool = capturedTool(name);
						if (!tool) throw new Error(`Unknown extension tool: ${name || "(missing name)"}`);
						operation.ref = `extensions.${name}`;
						operation.args = args;
						emit();
						const result = await invokeDefinition(tool.definition, args, operation, runtimeSignal);
						const text = bounded(resultText(result), MAX_GUEST_TOOL_RESULT_CHARS, `${operation.ref} output`).value;
						const content = portableValue(result.content);
						const details = portableValue(result.details);
						value = {
							text,
							...(content !== undefined ? { content } : {}),
							...(details !== undefined ? { details } : {}),
							...(result.usage ? { usage: result.usage } : {}),
						};
					} else if (ref === "skills.list") {
						value = listSkills({ cwd: ctx.cwd });
					} else if (ref === "skills.body") {
						const name = typeof rawArgs.name === "string" ? rawArgs.name : "";
						value = readSkillBody(name, { cwd: ctx.cwd });
					} else if (ref === "agent.run") {
						agentCalls++;
						if (agentCalls > agentBudget) throw new Error(`pi_exec agent budget exhausted (${agentBudget})`);
						const request = parseAgentRequest(rawArgs);
						const context = containsContextMarks(request.context) ? fitContext(request.context) : undefined;
						if (context) request.context = context.value;
						const result = await runAgent(agentCalls - 1, request, ctx, runtimeSignal, (nextActivity) => {
							operation.activity = nextActivity;
							emit();
						});
						if (result.usage) nestedUsages.push(result.usage);
						operation.children = result.operations;
						value = result.error
							? {
									status: "failed",
									error: result.error,
									text: result.output,
									toolCalls: result.operations.length,
									...(result.usage ? { usage: result.usage } : {}),
									...(context
										? {
												context: {
													truncated: context.truncated,
													dropped: context.dropped,
													serializedChars: context.serializedChars,
												},
											}
										: {}),
								}
							: {
									status: "completed",
									text: result.output,
									toolCalls: result.operations.length,
									...(result.value !== undefined ? { value: result.value } : {}),
									...(result.usage ? { usage: result.usage } : {}),
									...(context
										? {
												context: {
													truncated: context.truncated,
													dropped: context.dropped,
													serializedChars: context.serializedChars,
												},
											}
										: {}),
								};
						if (result.error) {
							operation.outcome = "failed";
							operation.error = result.error;
						}
					} else {
						const match = /^pi\.(.+)$/.exec(ref);
						const name = match?.[1];
						if (!name || !CORE_TOOL_NAMES.has(name)) throw new Error(`pi_exec does not expose ${ref}`);
						const definition =
							name === "bash"
								? definitionsFor(ctx.cwd).bash
								: (capturedTool(name)?.definition ?? definitionsFor(ctx.cwd)[name]!);
						try {
							const config = loadSearchRootGuardConfig(ctx.cwd, ctx.isProjectTrusted?.() ?? false);
							const blocked = searchRootBlockReason(name, rawArgs, ctx.cwd, { home: homedir(), ...config });
							if (blocked) throw new Error(blocked);
							const result = await invokeDefinition(definition, rawArgs, operation, runtimeSignal);
							const text = bounded(resultText(result), MAX_GUEST_TOOL_RESULT_CHARS, `${ref} output`).value;
							value = ENVELOPE_TOOLS.has(name) ? { ok: true, output: text } : text;
						} catch (error) {
							if (!ENVELOPE_TOOLS.has(name) || runtimeSignal.aborted) throw error;
							const output = error instanceof Error ? error.message : String(error);
							operation.outcome = "failed";
							operation.error = output;
							value = { ok: false, output: bounded(output, MAX_GUEST_TOOL_RESULT_CHARS, `${ref} output`).value };
						}
					}
					if (value !== undefined) serializeJsonValue({ value }, "pi_exec host result");
					operation.result =
						ref === "fetch" && value && typeof value === "object"
							? {
									status: (value as Record<string, unknown>).status,
									url: traceFetchUrl((value as Record<string, unknown>).url),
									bodyBytes: (value as Record<string, unknown>).bodyBytes,
								}
							: ref.startsWith("evidence.context_")
								? { bound: true }
								: traceValue(value);
					return value;
				} catch (error) {
					operation.outcome = runtimeSignal.aborted ? "aborted" : "failed";
					operation.error = error instanceof Error ? error.message : String(error);
					throw error;
				} finally {
					activeOperations.delete(operation);
					if (acquired) release();
					pendingOperations.delete(operation);
					delete operation.activity;
					emit();
				}
			};

			try {
				if (params.reset) {
					await discard();
					selected = { found: false };
					notice = undefined;
				}
				// Monty counts suspensions across a checkout; rebase from the last checkpoint before the next call could exhaust it.
				if (owner && hostCalls + callBudget > PROGRAM_ENVELOPE_MAXIMA.callBudget) {
					await discard();
					selected = branchCheckpoint(ctx);
				}
				const currentGeneration = generation;
				const live = await ensureOwner(ctx);
				if (currentGeneration !== generation) {
					if (owner === live) {
						owner = undefined;
						await live.close().catch((error) => console.error("pi_exec Monty cleanup failed", error));
					}
					throw new Error("pi_exec session changed during checkout");
				}
				if (params.reset) {
					try {
						await appendCheckpoint(ctx, live, currentGeneration);
					} catch (error) {
						if (owner === live) {
							owner = undefined;
							await live.close().catch((cleanupError) => console.error("pi_exec Monty cleanup failed", cleanupError));
						}
						throw error;
					}
				}
				const callNotice = notice;
				notice = undefined;
				activeAbort = new AbortController();
				const workerPid = live.session.workerPid;
				const runtimeSignal = signal ? AbortSignal.any([signal, activeAbort.signal]) : activeAbort.signal;
				let result = await executeProgram(
					live.session,
					params.code,
					params.inputs ?? {},
					envelope.timeoutSeconds * 1_000,
					hostCall,
					runtimeSignal,
					(values) => logs.push(values.map(displayValue).join(" ")),
					() => stopWorker(live, workerPid),
				);
				hostCalls += calls;
				if (result.sessionUsable && currentGeneration === generation && owner === live) {
					try {
						await appendCheckpoint(ctx, live, currentGeneration);
					} catch (error) {
						result = {
							outcome: "failed",
							error: `pi_exec could not save Monty state: ${error instanceof Error ? error.message : String(error)}`,
							sessionUsable: false,
						};
					}
				}
				if (!result.sessionUsable || currentGeneration !== generation) {
					if (owner === live) {
						owner = undefined;
						ownerHash = undefined;
						hostCalls = 0;
					}
					await live.close().catch((error) => console.error("pi_exec Monty cleanup failed", error));
					result = {
						...result,
						outcome: result.outcome === "succeeded" ? "aborted" : result.outcome,
						error: `${result.error ?? "pi_exec session changed"} ${ROLLBACK_NOTICE}`,
						sessionUsable: false,
					};
				}
				finishedAt = Date.now();
				if (result.outcome !== "succeeded") {
					for (const operation of pendingOperations) {
						operation.outcome = result.outcome === "failed" ? "aborted" : result.outcome;
						operation.error = `pi_exec ${result.outcome}`;
					}
					pendingOperations.clear();
					activeOperations.clear();
				}
				const trace = {
					kind: "apple-pi.execution" as const,
					version: 1 as const,
					outcome: result.outcome,
					operations: structuredClone(operations),
				};
				const finalActivity = activity();
				if (result.outcome !== "succeeded") {
					failedDetails.set(toolCallId, {
						details: {
							trace,
							logs,
							activity: finalActivity,
							policy: envelope,
							...(callNotice ? { notice: callNotice } : {}),
						},
						...(nestedUsages.length > 0 ? { usage: aggregateUsage(nestedUsages) } : {}),
					});
					throw new Error(`${result.error ?? `pi_exec ${result.outcome}`}${callNotice ? `\n${callNotice}` : ""}`);
				}
				const output = [
					callNotice ? `Notice: ${callNotice}` : "",
					logs.length > 0 ? `Logs:\n${logs.join("\n")}` : "",
					displayValue(result.value),
				]
					.filter(Boolean)
					.join("\n\n");
				return {
					content: [{ type: "text" as const, text: output }],
					details: {
						trace,
						logs,
						activity: finalActivity,
						policy: envelope,
						...(callNotice ? { notice: callNotice } : {}),
					},
					...(nestedUsages.length > 0 ? { usage: aggregateUsage(nestedUsages) } : {}),
				};
			} finally {
				executing = false;
				activeAbort = undefined;
				widget?.dispose();
				if (widgetMounted) {
					try {
						ctx.ui.setWidget(EXEC_WIDGET_ID, undefined);
					} catch (error) {
						ctx.ui.notify(
							`pi_exec activity widget cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
							"warning",
						);
					}
				}
			}
		},
	});
	pi.registerTool(piExecTool);

	function syncSavedProgramTools(cwd: string): void {
		try {
			for (const program of listSavedPrograms(cwd)) {
				const parameters = buildProgramParametersSchema(
					program.params,
					piExecTool.parameters.properties.reset,
					piExecTool.parameters.properties.limits,
				);
				pi.registerTool({
					name: savedProgramToolName(program.name),
					label: program.description,
					executionMode: "sequential",
					description: `Execute project-local Python program '${program.name}' (.pi/programs/${program.name}.py): ${program.description}`,
					promptSnippet: program.description,
					promptGuidelines: [SAVED_PROGRAM_PROMPT_GUIDELINE],
					parameters,
					async execute(toolCallId, rawParams, signal, onUpdate, ctx) {
						if (typeof ctx.isProjectTrusted !== "function" || !ctx.isProjectTrusted()) {
							throw new Error("pi_exec saved programs require a trusted project");
						}
						const current = readSavedProgram(ctx.cwd, program.name);
						const { reset, limits, inputs: explicitInputs, ...rest } = rawParams as Record<string, any>;
						// Defaults belong to the registered schema, not a mid-turn source edit.
						const inputs: Record<string, string> = Object.create(null);
						for (const param of program.params) {
							if (param.default !== undefined) inputs[param.name] = String(param.default);
						}
						Object.assign(inputs, explicitInputs ?? {});
						for (const [key, value] of Object.entries(rest)) {
							if (value !== undefined) inputs[key] = String(value);
						}
						return piExecTool.execute(
							toolCallId,
							{
								code: current.code,
								inputs,
								...(reset ? { reset } : {}),
								...(limits ? { limits } : {}),
								display: { name: current.name, description: current.description },
							},
							signal,
							onUpdate,
							ctx,
						);
					},
				});
			}
		} catch {
			// Missing, inaccessible, or unconfined programs directories expose no tools.
		}
	}

	function hasSessionMessages(ctx: ExtensionContext): boolean {
		try {
			return (ctx.sessionManager.getBranch() ?? []).some((entry) => entry.type === "message");
		} catch {
			// If the cache state is unknown, do not risk a mid-turn schema mutation.
			return true;
		}
	}

	pi.on("session_start", (_event, ctx) => syncSavedProgramTools(ctx.cwd));
	pi.on("session_compact", (_event, ctx) => syncSavedProgramTools(ctx.cwd));
	pi.on("before_agent_start", (_event, ctx) => {
		if (!hasSessionMessages(ctx)) syncSavedProgramTools(ctx.cwd);
	});
	syncSavedProgramTools(process.cwd());
}
