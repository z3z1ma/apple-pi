import { createHash } from "node:crypto";
import { homedir } from "node:os";
import type { Usage } from "@earendil-works/pi-ai";
import {
	defineTool,
	type ExtensionAPI,
	type ExtensionContext,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { loadSearchRootGuardConfig } from "../../home-search-guard/src/config.js";
import { searchRootBlockReason } from "../../home-search-guard/src/index.js";
import { agentOperationArgs, runAgentWorker } from "./agent-workers.js";
import { sealCheckpoint, verifyCheckpoint } from "./checkpoint.js";
import { coreToolDefinition, ENVELOPE_TOOL_NAMES, isCoreToolName } from "./core-tools.js";
import { deriveProgramEnvelope, PROGRAM_ENVELOPE_MAXIMA } from "./envelope.js";
import { EVIDENCE_FUNCTION_NAMES, runEvidenceFunction } from "./evidence.js";
import { executeFetch, fetchOperationArgs, traceFetchUrl } from "./fetch.js";
import {
	attachLiveDescription,
	guestPythonStubs,
	PI_EXEC_DESCRIPTION,
	PI_EXEC_DISPLAY_PARAMETER_DESCRIPTION,
	PI_EXEC_PROMPT_GUIDELINES,
	PI_EXEC_PROMPT_SNIPPET,
	piExecGuestApiContract,
} from "./guest-api.js";
import { serializeJsonValue } from "./json.js";
import { createProgramSession, executeProgram, isOwnedMontyWorker } from "./program.js";
import { aggregateUsage, bounded, resultText, traceValue } from "./results.js";
import { installSavedProgramTools, SAVED_PROGRAM_PROMPT_GUIDELINE } from "./saved-programs.js";
import { listSkills, readSkillBody } from "./skills.js";
import { capturedTool, capturedTools, installRegisteredToolCapture } from "./tool-capture.js";
import type { ExecutionOperation, ProgramHostCall } from "./types.js";
import { type ExecActivitySnapshot, ExecActivityWidget, renderExecCall, renderExecResult } from "./ui.js";

const MAX_GUEST_TOOL_RESULT_CHARS = 50_000;
const EXEC_WIDGET_ID = "apple-pi:exec-activity";
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

export default function piExec(pi: ExtensionAPI): void {
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
		description: PI_EXEC_DESCRIPTION,
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
						const result = await runAgentWorker(agentCalls - 1, rawArgs, ctx, runtimeSignal, (nextActivity) => {
							operation.activity = nextActivity;
							emit();
						});
						if (result.usage) nestedUsages.push(result.usage);
						operation.children = result.operations;
						value = result.record;
						if (result.error) {
							operation.outcome = "failed";
							operation.error = result.error;
						}
					} else {
						const match = /^pi\.(.+)$/.exec(ref);
						const name = match?.[1];
						if (!name || !isCoreToolName(name)) throw new Error(`pi_exec does not expose ${ref}`);
						const definition = coreToolDefinition(name, ctx.cwd);
						try {
							const config = loadSearchRootGuardConfig(ctx.cwd, ctx.isProjectTrusted?.() ?? false);
							const blocked = searchRootBlockReason(name, rawArgs, ctx.cwd, { home: homedir(), ...config });
							if (blocked) throw new Error(blocked);
							const result = await invokeDefinition(definition, rawArgs, operation, runtimeSignal);
							const text = bounded(resultText(result), MAX_GUEST_TOOL_RESULT_CHARS, `${ref} output`).value;
							value = ENVELOPE_TOOL_NAMES.has(name) ? { ok: true, output: text } : text;
						} catch (error) {
							if (!ENVELOPE_TOOL_NAMES.has(name) || runtimeSignal.aborted) throw error;
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

	installSavedProgramTools(pi, piExecTool);
}
