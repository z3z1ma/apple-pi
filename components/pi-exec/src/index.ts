import type { Usage } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { registerWorkSection } from "../../shared/src/work-manager.js";
import { ExecPanel, type ExecInvocation } from "./work-panel.js";
import { deriveProgramEnvelope, PROGRAM_ENVELOPE_MAXIMA } from "./envelope.js";
import {
	attachLiveDescription,
	PI_EXEC_DESCRIPTION,
	PI_EXEC_DISPLAY_PARAMETER_DESCRIPTION,
	PI_EXEC_PROMPT_GUIDELINES,
	PI_EXEC_PROMPT_SNIPPET,
	piExecGuestApiContract,
} from "./guest-api.js";
import { createHostCalls } from "./host-calls.js";
import { installSavedProgramTools, SAVED_PROGRAM_PROMPT_GUIDELINE } from "./saved-programs.js";
import { installProgramSession } from "./session.js";
import { installRegisteredToolCapture } from "./tool-capture.js";
import { type ExecActivitySnapshot, ExecActivityWidget, renderExecCall, renderExecResult } from "./ui.js";

const EXEC_WIDGET_ID = "apple-pi:exec-activity";

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Tool details keep their existing shape; live worker children belong to the in-memory inspection record only. */
function detailsActivity(snapshot: ExecActivitySnapshot): ExecActivitySnapshot {
	return { ...snapshot, calls: snapshot.calls.map(({ children: _children, ...call }) => call) };
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
		captureError = errorText(error);
	}
	const failedDetails = new Map<string, { details: unknown; usage?: Usage }>();
	let executing = false;
	const programSession = installProgramSession(pi);
	const invocations = new Map<string, ExecInvocation>();
	// All extension installers have finished before session_start; work loads after Pi Exec.
	pi.on("session_start", (_event, ctx) => {
		invocations.clear();
		if (!ctx.hasUI || ctx.mode !== "tui") return;
		registerWorkSection(pi, {
			key: "exec",
			label: "Pi Exec",
			create: (ui, selectedId) => new ExecPanel(ui, () => [...invocations.values()].reverse(), selectedId),
		});
	});
	pi.on("session_tree", () => {
		invocations.clear();
	});
	pi.on("session_shutdown", () => {
		invocations.clear();
	});
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
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			if (executing) throw new Error("pi_exec already has a running program in this session");
			executing = true;
			const startedAt = Date.now();
			const envelope = deriveProgramEnvelope(params.code, params.limits);
			const programName = params.display?.name?.trim() || "Program";
			const logs: string[] = [];
			const invocation: ExecInvocation = {
				id: toolCallId,
				code: params.code,
				status: "running",
				activity: { name: programName, description: params.display?.description, startedAt, calls: [] },
			};
			invocations.set(toolCallId, invocation);
			let finishedAt: number | undefined;
			let widget: ExecActivityWidget | undefined;
			let widgetMounted = false;
			const activity = (): ExecActivitySnapshot => ({
				name: programName,
				...(params.display?.description ? { description: params.display.description } : {}),
				startedAt,
				...(finishedAt !== undefined ? { finishedAt } : {}),
				calls: host.activityCalls(),
			});
			const emit = () => {
				if (finishedAt !== undefined) return;
				const completed = host.completedOperations();
				invocation.activity = activity();
				widget?.refresh();
				onUpdate?.({
					content: [{ type: "text", text: `pi_exec: ${completed.length} of ${host.attempted()} calls completed` }],
					details: {
						trace: { kind: "apple-pi.execution", version: 1, outcome: "succeeded", operations: completed },
						activity: detailsActivity(invocation.activity),
					},
				});
			};
			const host = createHostCalls({ ctx, toolCallId, envelope, captureError, onChange: emit });

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
					ctx.ui.notify(`pi_exec activity widget unavailable: ${errorText(error)}`, "warning");
				}
			}

			try {
				const { execution: result, notice: callNotice } = await programSession.run(ctx, {
					code: params.code,
					inputs: params.inputs ?? {},
					timeoutMs: envelope.timeoutSeconds * 1_000,
					callBudget: envelope.callBudget,
					reset: params.reset === true,
					hostCall: host.hostCall,
					signal,
					onLog: (values) => logs.push(values.map(displayValue).join(" ")),
				});
				finishedAt = Date.now();
				const trace = {
					kind: "apple-pi.execution" as const,
					version: 1 as const,
					outcome: result.outcome,
					operations: host.finish(result.outcome),
				};
				const finalActivity = activity();
				invocation.activity = finalActivity;
				invocation.status = result.outcome;
				invocation.trace = trace.operations;
				const usage = host.usage();
				if (result.outcome !== "succeeded") {
					if (logs.length > 0) invocation.output = `Logs:\n${logs.join("\n")}`;
					failedDetails.set(toolCallId, {
						details: {
							trace,
							logs,
							activity: detailsActivity(finalActivity),
							policy: envelope,
							...(callNotice ? { notice: callNotice } : {}),
						},
						...(usage ? { usage } : {}),
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
				invocation.output = output;
				return {
					content: [{ type: "text" as const, text: output }],
					details: {
						trace,
						logs,
						activity: detailsActivity(finalActivity),
						policy: envelope,
						...(callNotice ? { notice: callNotice } : {}),
					},
					...(usage ? { usage } : {}),
				};
			} catch (error) {
				invocation.error = errorText(error);
				if (invocation.status === "running") {
					finishedAt = Date.now();
					invocation.status = "failed";
					invocation.trace = host.finish("failed");
					invocation.activity = activity();
				}
				throw error;
			} finally {
				executing = false;
				widget?.dispose();
				if (widgetMounted) {
					try {
						ctx.ui.setWidget(EXEC_WIDGET_ID, undefined);
					} catch (error) {
						ctx.ui.notify(`pi_exec activity widget cleanup failed: ${errorText(error)}`, "warning");
					}
				}
			}
		},
	});
	pi.registerTool(piExecTool);

	installSavedProgramTools(pi, piExecTool);
}
