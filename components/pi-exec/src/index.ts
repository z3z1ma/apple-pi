import type { Usage } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
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
	let executing = false;
	const programSession = installProgramSession(pi);
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
				widget?.refresh();
				onUpdate?.({
					content: [{ type: "text", text: `pi_exec: ${completed.length} of ${host.attempted()} calls completed` }],
					details: {
						trace: { kind: "apple-pi.execution", version: 1, outcome: "succeeded", operations: completed },
						activity: activity(),
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
					ctx.ui.notify(
						`pi_exec activity widget unavailable: ${error instanceof Error ? error.message : String(error)}`,
						"warning",
					);
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
				const usage = host.usage();
				if (result.outcome !== "succeeded") {
					failedDetails.set(toolCallId, {
						details: {
							trace,
							logs,
							activity: finalActivity,
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
				return {
					content: [{ type: "text" as const, text: output }],
					details: {
						trace,
						logs,
						activity: finalActivity,
						policy: envelope,
						...(callNotice ? { notice: callNotice } : {}),
					},
					...(usage ? { usage } : {}),
				};
			} finally {
				executing = false;
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
