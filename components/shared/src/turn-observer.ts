import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { createFileChangeTracker, type FileChange } from "./file-changes.js";
import { aggregateUsage, resultText, traceValue } from "./model-results.js";
import { PI_EXEC_RETURN_TOOL, resolveStructuredOutput } from "./structured-output.js";
import { mainToolArgument } from "./tool-activity.js";

export interface ObservedOperation {
	sequence: number;
	ref: string;
	args: Record<string, unknown>;
	outcome: "succeeded" | "failed" | "aborted";
	result?: unknown;
	error?: string;
}

export interface ObservedCall extends ObservedOperation {
	status: "running" | ObservedOperation["outcome"];
	startedAt: number;
	finishedAt?: number;
}

export interface TurnProgress {
	activity: string;
	children: ObservedCall[];
}

export interface TurnResult {
	status: "completed" | "failed";
	text: string;
	value?: unknown;
	error?: string;
	stopReason?: string;
	usage?: Usage;
	operations: ObservedOperation[];
	changes: FileChange[];
}

/** Observe one run, whether its events arrive from Pi's SDK or a one-shot process's JSON stream. */
export function createTurnObserver(cwd: string, onProgress: (progress: TurnProgress) => void = () => {}) {
	const files = createFileChangeTracker(cwd);
	const calls = new Map<string, ObservedCall>();
	const usages: Usage[] = [];
	let last: AssistantMessage | undefined;
	let returned: unknown;
	let activity = "thinking";
	const publish = () => onProgress({ activity, children: structuredClone([...calls.values()]) });
	const finishCall = (id: string, isError: boolean, result: unknown) => {
		const call = calls.get(id);
		if (!call) return;
		call.outcome = isError ? "failed" : "succeeded";
		call.status = call.outcome;
		call.result = traceValue(resultText(result));
		if (isError) call.error = resultText(result).slice(0, 500);
		call.finishedAt ??= Date.now();
	};
	return {
		observe(event: AgentSessionEvent) {
			files.observe(event);
			if (event.type === "message_start" && event.message.role === "assistant") {
				activity = "thinking";
				publish();
			} else if (event.type === "tool_execution_start") {
				activity = [event.toolName, mainToolArgument(event.args)].filter(Boolean).join(" ");
				publish();
			} else if (event.type === "tool_execution_end") {
				finishCall(event.toolCallId, event.isError, event.result);
				if (event.toolName === PI_EXEC_RETURN_TOOL)
					returned = event.isError ? undefined : (event.result as { details?: unknown }).details;
				publish();
			} else if (event.type === "message_end") {
				const message = event.message;
				if (message.role === "assistant") {
					last = message;
					if (message.usage) usages.push(message.usage);
					for (const part of message.content) {
						if (part.type !== "toolCall") continue;
						calls.set(part.id, {
							sequence: calls.size,
							ref: part.name === PI_EXEC_RETURN_TOOL ? part.name : `pi.${part.name}`,
							args: part.arguments,
							outcome: "aborted",
							status: "running",
							startedAt: Date.now(),
						});
					}
					activity = message.stopReason === "toolUse" ? "using tools" : "finishing";
					publish();
				} else if (message.role === "toolResult") {
					finishCall(message.toolCallId, message.isError, message);
					publish();
				}
			}
		},
		finish(options: { aborted?: boolean; error?: string; outputSchema?: Record<string, unknown> } = {}): TurnResult {
			let error = options.error;
			if (options.aborted) error = "Run aborted";
			else if (!error && last?.stopReason === "length") error = "Model hit its output token limit; its text is partial";
			else if (!error && (last?.stopReason === "error" || last?.stopReason === "aborted"))
				error = last.errorMessage || `Model stopped with ${last.stopReason}`;
			else if (!error && !last) error = "Run produced no assistant reply";
			const structured = resolveStructuredOutput(options.outputSchema, returned);
			error ??= structured.error;
			for (const call of calls.values()) {
				if (call.status !== "running") continue;
				call.status = "aborted";
				call.finishedAt = Date.now();
			}
			publish();
			return {
				status: error ? "failed" : "completed",
				text:
					last?.content
						.filter((part) => part.type === "text")
						.map((part) => part.text)
						.join("\n") ?? "",
				...(error ? { error } : {}),
				...(last ? { stopReason: last.stopReason } : {}),
				...(!error && structured.value !== undefined ? { value: structured.value } : {}),
				...(usages.length ? { usage: aggregateUsage(usages) } : {}),
				operations: [...calls.values()].map(
					({ status: _status, startedAt: _start, finishedAt: _end, ...call }) => call,
				),
				changes: files.changes(),
			};
		},
	};
}
