import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import type { Usage } from "@earendil-works/pi-ai";
import {
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	type ExtensionAPI,
	type ExtensionContext,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { ProgramEnvelope } from "../components/shared/src/runtime-envelope.js";
import {
	agentOperationArgs,
	PI_EXEC_RETURN_TOOL,
	parseAgentRequest,
	prepareAgentSpawn,
	resolveStructuredOutput,
} from "./runtime-agent.js";
import {
	attachLiveDescription,
	PI_EXEC_DISPLAY_PARAMETER_DESCRIPTION,
	PI_EXEC_PROMPT_GUIDELINES,
	PI_EXEC_PROMPT_SNIPPET,
	piExecGuestApiContract,
	piExecToolDescription,
} from "./runtime-api.js";
import { capturedTool, capturedTools, installRegisteredToolCapture } from "./runtime-tools.js";
import type { ExecutionOperation, ProgramHostCall, WorkerResult } from "./runtime-types.js";
import { type ExecActivitySnapshot, ExecActivityWidget, renderExecCall, renderExecResult } from "./runtime-ui.js";

export type { ProgramEnvelope } from "../components/shared/src/runtime-envelope.js";
export type {
	ExecutionOperation,
	ExecutionOutcome,
	ProgramExecution,
	ProgramHostCall,
	WorkerResult,
} from "./runtime-types.js";

const MAX_OUTPUT_CHARS = 50_000;
const MAX_NESTED_RESULT_CHARS = 50_000;
const MAX_TRACE_RESULT_CHARS = 4_000;
const DEFAULT_CALL_BUDGET = 128;
const DEFAULT_CONCURRENCY = 16;
const DEFAULT_AGENT_BUDGET = 8;

/** Package-owned bounds derived from program shape, never model-selected arithmetic. */
export function deriveProgramEnvelope(code: string): ProgramEnvelope {
	const hasWorkers = /\bagent\s*\(|\bagents\.run\s*\(/.test(code);
	const hasFanout = /\bPromise\.all\s*\(|\bparallel\s*\(/.test(code);
	const callBudget = Math.min(DEFAULT_CALL_BUDGET, Math.max(64, 64 + Math.ceil(Buffer.byteLength(code) / 2_048) * 8));
	return {
		callBudget,
		concurrency: hasFanout ? DEFAULT_CONCURRENCY : Math.min(8, DEFAULT_CONCURRENCY),
		agentBudget: hasWorkers ? DEFAULT_AGENT_BUDGET : 0,
		memoryMb: 128,
		timeoutSeconds: hasWorkers ? 600 : 300,
	};
}
const CORE_TOOL_LIST = ["read", "grep", "find", "ls", "bash", "edit", "write"] as const;
const READ_ONLY_TOOLS = ["read", "grep", "find", "ls"] as const;
const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const EXEC_WIDGET_ID = "apple-pi:exec-activity";
const CORE_TOOL_NAMES = new Set<string>(CORE_TOOL_LIST);
const ENVELOPE_TOOLS = new Set(["bash", "edit", "write"]);

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
			bash: createBashToolDefinition(cwd),
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
	const requestedTools = request.tools ?? [...READ_ONLY_TOOLS];
	if (requestedTools.some((tool) => !CORE_TOOL_NAMES.has(tool))) {
		throw new Error(`agent tools must be selected from: ${CORE_TOOL_LIST.join(", ")}`);
	}
	if (request.thinking && !THINKING_LEVELS.has(request.thinking)) {
		throw new Error(`agent thinking must be one of: ${[...THINKING_LEVELS].join(", ")}`);
	}
	const model = request.model ?? (ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined);
	const thinking = request.thinking ?? ctx.thinkingLevel;
	const prepared = prepareAgentSpawn(request, {
		tools: requestedTools,
		...(model ? { model } : {}),
		...(thinking ? { thinking } : {}),
	});

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
				if (aborted) error = "agent aborted";
				if (!error && exitCode !== 0) error = stderr.trim() || `agent exited with code ${exitCode}`;
				if (!error && stopReason && ["error", "aborted"].includes(stopReason)) {
					error = stderr.trim() || `agent stopped with ${stopReason}`;
				}
				const structured = resolveStructuredOutput(request.outputSchema, acceptedReturn);
				if (!error && structured.error) error = structured.error;
				const output = bounded(
					structured.value !== undefined && !error
						? JSON.stringify(structured.value)
						: stdout || error || "(agent returned no text)",
					MAX_NESTED_RESULT_CHARS,
					"pi_exec agent output",
				);
				resolve({
					index,
					task: request.task,
					output: output.value,
					truncated: output.truncated,
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

import { executeProgram } from "./runtime-program.js";

export { executeProgram } from "./runtime-program.js";

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

function portableValue(value: unknown, maxChars = MAX_NESTED_RESULT_CHARS): unknown {
	if (value === undefined) return undefined;
	try {
		const json = JSON.stringify(value, (_key, nested) => (typeof nested === "bigint" ? String(nested) : nested));
		if (json === undefined) return undefined;
		if (json.length <= maxChars) return JSON.parse(json) as unknown;
		return {
			truncated: true,
			originalChars: json.length,
			preview: json.slice(0, maxChars),
		};
	} catch {
		return String(value);
	}
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

export default function runtime(pi: ExtensionAPI): void {
	let captureError: string | undefined;
	try {
		installRegisteredToolCapture();
	} catch (error) {
		captureError = error instanceof Error ? error.message : String(error);
	}
	const failedDetails = new Map<string, { details: unknown; usage?: Usage }>();
	pi.on("tool_result", (event) => {
		if (event.toolName !== "pi_exec" || !event.isError) return;
		const failure = failedDetails.get(event.toolCallId);
		if (!failure) return;
		failedDetails.delete(event.toolCallId);
		return failure;
	});

	pi.registerTool({
		name: "pi_exec",
		label: "Pi Exec",
		executionMode: "sequential",
		get description() {
			return piExecToolDescription();
		},
		promptSnippet: PI_EXEC_PROMPT_SNIPPET,
		promptGuidelines: [...PI_EXEC_PROMPT_GUIDELINES],
		parameters: Type.Object({
			code: attachLiveDescription(Type.String({ minLength: 1, maxLength: 100_000 }), piExecGuestApiContract),
			inputs: Type.Optional(
				Type.Record(Type.String(), Type.String({ maxLength: 200_000 }), {
					description: "Named strings available to the program as inputs.<key>.",
				}),
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
		}),
		renderCall(args, theme, context) {
			return renderExecCall(args, theme, context);
		},
		renderResult(result, options, theme, context) {
			return renderExecResult(result as any, options, theme, context);
		},
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const startedAt = Date.now();
			const envelope = deriveProgramEnvelope(params.code);
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
							: ref === "agents.run"
								? agentOperationArgs(rawArgs)
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
					} else if (ref === "tools.list" || ref === "tools.search" || ref === "tools.describe") {
						const tools = availableExtensionTools();
						const query = typeof rawArgs.query === "string" ? rawArgs.query.toLowerCase() : "";
						const name = typeof rawArgs.name === "string" ? rawArgs.name : "";
						const descriptors = tools.map((tool) => ({
							name: tool.name,
							description: tool.description,
							...(ref === "tools.describe" ? { parameters: portableValue(tool.parameters) } : {}),
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
						const text = bounded(resultText(result), MAX_NESTED_RESULT_CHARS, `${operation.ref} output`).value;
						value = {
							text,
							content: portableValue(result.content),
							details: portableValue(result.details),
							...(result.usage ? { usage: result.usage } : {}),
						};
					} else if (ref === "agents.run") {
						agentCalls++;
						if (agentCalls > agentBudget) throw new Error(`pi_exec agent budget exhausted (${agentBudget})`);
						const request = parseAgentRequest(rawArgs);
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
								}
							: {
									status: "completed",
									text: result.output,
									toolCalls: result.operations.length,
									...(result.value !== undefined ? { value: result.value } : {}),
									...(result.usage ? { usage: result.usage } : {}),
								};
						if (result.error) {
							operation.outcome = "failed";
							operation.error = result.error;
						}
					} else {
						const match = /^pi\.(.+)$/.exec(ref);
						const name = match?.[1];
						if (!name || !CORE_TOOL_NAMES.has(name)) throw new Error(`pi_exec does not expose ${ref}`);
						const definition = capturedTool(name)?.definition ?? definitionsFor(ctx.cwd)[name]!;
						const result = await invokeDefinition(definition, rawArgs, operation, runtimeSignal);
						const text = bounded(resultText(result), MAX_NESTED_RESULT_CHARS, `${ref} output`).value;
						value = ENVELOPE_TOOLS.has(name) ? { ok: true, output: text } : text;
					}
					operation.result =
						ref === "fetch" && value && typeof value === "object"
							? {
									status: (value as Record<string, unknown>).status,
									url: traceFetchUrl((value as Record<string, unknown>).url),
									bodyBytes: (value as Record<string, unknown>).bodyBytes,
								}
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
				const timeoutMs = envelope.timeoutSeconds * 1_000;
				const result = await executeProgram(
					params.code,
					params.inputs ?? {},
					timeoutMs,
					hostCall,
					signal,
					(values) => logs.push(values.map(displayValue).join(" ")),
					envelope.memoryMb,
				);
				finishedAt = Date.now();
				if (result.outcome !== "succeeded") {
					for (const operation of pendingOperations) {
						operation.outcome = result.outcome;
						operation.error = result.error ?? `pi_exec ${result.outcome}`;
					}
					pendingOperations.clear();
					activeOperations.clear();
				}
				const trace = {
					kind: "apple-pi.execution" as const,
					version: 1 as const,
					outcome: result.outcome,
					operations,
				};
				const finalActivity = activity();
				if (result.outcome !== "succeeded") {
					failedDetails.set(toolCallId, {
						details: { trace, logs, activity: finalActivity, policy: envelope },
						...(nestedUsages.length > 0 ? { usage: aggregateUsage(nestedUsages) } : {}),
					});
					throw new Error(result.error ?? `pi_exec ${result.outcome}`);
				}
				const output = bounded(
					[logs.length > 0 ? `Logs:\n${logs.join("\n")}` : "", displayValue(result.value)].filter(Boolean).join("\n\n"),
					MAX_OUTPUT_CHARS,
					"pi_exec output",
				).value;
				return {
					content: [{ type: "text", text: output }],
					details: { trace, logs, activity: finalActivity, policy: envelope },
					...(nestedUsages.length > 0 ? { usage: aggregateUsage(nestedUsages) } : {}),
				};
			} finally {
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
}
