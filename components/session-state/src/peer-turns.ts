import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { normalizeOutputSchema, structuredReturnTool } from "../../shared/src/structured-output.js";
import { createTurnObserver, type TurnProgress, type TurnResult } from "../../shared/src/turn-observer.js";
import { RETRY_MS } from "./client.js";

export interface PeerTurn {
	task: string;
	outputSchema?: Record<string, unknown>;
	contextFile?: string;
}

interface Request extends PeerTurn {
	id: string;
	progress(value: TurnProgress): void;
	finish(value: TurnResult): void;
}

const failed = (error: string): TurnResult => ({ status: "failed", text: "", error, operations: [], changes: [] });

/** Runs correlated requests in this person's session; it owns no person or process. */
export function installPeerTurns(pi: ExtensionAPI) {
	let current: ExtensionContext | undefined;
	let active: { request: Request; observer: ReturnType<typeof createTurnObserver> } | undefined;
	const queue: Request[] = [];
	let timer: NodeJS.Timeout | undefined;

	const hideReturn = (request: Request) => {
		if (request.outputSchema) pi.registerTool({ ...structuredReturnTool(request.outputSchema), exposure: "hidden" });
	};
	const schedule = () => {
		if (timer || active || queue.length === 0 || !current) return;
		timer = setTimeout(drain, RETRY_MS);
		timer.unref();
	};
	const drain = () => {
		timer = undefined;
		if (!current || active || queue.length === 0) return;
		if (!current.isIdle()) return schedule();
		const request = queue.shift()!;
		if (!current.model) {
			request.finish(failed("No model selected in the peer"));
			schedule();
			return;
		}
		try {
			if (request.outputSchema) pi.registerTool(structuredReturnTool(request.outputSchema));
			active = { request, observer: createTurnObserver(current.cwd, request.progress) };
			pi.sendMessage(
				{
					customType: "organization.program-request",
					content: [
						"A colleague is awaiting this turn's result. Say what you verified and what you believe.",
						request.outputSchema
							? "Finish by calling pi_exec_return with the requested value. That call returns it directly to the program."
							: "Your final reply returns directly to the caller.",
						request.contextFile ? `Bound context: read ${request.contextFile} as the data for this request.` : "",
						request.task,
					]
						.filter(Boolean)
						.join("\n\n"),
					display: true,
					details: { requestId: request.id },
				},
				{ triggerTurn: true },
			);
		} catch (error) {
			active = undefined;
			hideReturn(request);
			request.finish(failed(error instanceof Error ? error.message : String(error)));
			schedule();
		}
	};
	const reset = (reason: string) => {
		clearTimeout(timer);
		timer = undefined;
		const previous = active;
		active = undefined;
		if (previous) {
			hideReturn(previous.request);
			previous.request.finish(previous.observer.finish({ error: reason }));
		}
		for (const request of queue.splice(0)) request.finish(failed(reason));
	};
	pi.on("session_start", (_event, ctx) => {
		reset("The peer session changed");
		current = ctx;
	});
	pi.on("session_tree", (_event, ctx) => {
		reset("The peer selected another branch");
		current = ctx;
	});
	pi.on("session_shutdown", () => {
		reset("The peer session closed");
		current = undefined;
	});
	pi.on("message_start", (event) => active?.observer.observe(event));
	pi.on("message_end", (event) => active?.observer.observe(event));
	pi.on("tool_execution_start", (event) => active?.observer.observe(event));
	pi.on("tool_execution_end", (event) => active?.observer.observe(event));
	pi.on("agent_settled", (event) => {
		const done = active;
		active = undefined;
		if (done) {
			hideReturn(done.request);
			done.request.finish(done.observer.finish({ aborted: event.aborted, outputSchema: done.request.outputSchema }));
		}
		// Settlement handlers are notification-only, and isIdle stays false until every handler returns.
		schedule();
	});
	return {
		disconnect() {
			const wasRunning = active !== undefined;
			reset("The peer lost its connection to the runtime");
			if (wasRunning) current?.abort();
		},
		enqueue(request: Request) {
			if (!current) return request.finish(failed("The peer session is not ready"));
			if (!request.task.trim()) return request.finish(failed("Give the peer a task"));
			try {
				if (request.outputSchema) request.outputSchema = normalizeOutputSchema(request.outputSchema);
			} catch (error) {
				request.finish(failed(error instanceof Error ? error.message : String(error)));
				return;
			}
			queue.push(request);
			request.progress({ activity: "waiting for the peer to be idle", children: [] });
			schedule();
		},
		cancel(id: string) {
			const waiting = queue.findIndex((request) => request.id === id);
			if (waiting >= 0) queue.splice(waiting, 1)[0]!.finish(failed("Peer request cancelled before it started"));
			else if (active?.request.id === id) current?.abort();
		},
	};
}
