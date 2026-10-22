import type { Usage } from "@earendil-works/pi-ai";
import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";
import { aggregateUsage, resultText, traceValue } from "../../shared/src/model-results.js";
import type { ProgramEnvelope } from "./envelope.js";
import { type HostCallScope, hostFunction } from "./guest-functions.js";
import { serializeJsonValue } from "./json.js";
import type { ExecutionOperation, ExecutionOutcome, ProgramHostCall } from "./types.js";
import type { ExecActivityCall } from "./ui.js";

export interface HostCallsOptions {
	ctx: ExtensionToolContext;
	toolCallId: string;
	envelope: ProgramEnvelope;
	onChange(): void;
}

/**
 * Serve one program run's host calls: enforce the call, agent, and concurrency budgets, run the host function,
 * and keep the operation trace, activity rows, and model-worker usage.
 */
export function createHostCalls(options: HostCallsOptions) {
	const { ctx, toolCallId, envelope, onChange } = options;
	const operations: ExecutionOperation[] = [];
	const pending = new Set<ExecutionOperation>();
	const running = new Set<ExecutionOperation>();
	const timings = new Map<ExecutionOperation, { queuedAt: number; startedAt?: number; finishedAt?: number }>();
	const children = new Map<ExecutionOperation, ExecActivityCall[]>();
	const usages: Usage[] = [];
	const waiters: Array<() => void> = [];
	let attempted = 0;
	let active = 0;
	let agentCalls = 0;

	const acquire = async (signal: AbortSignal): Promise<void> => {
		if (active < envelope.concurrency) {
			active++;
			return;
		}
		await new Promise<void>((resolve, reject) => {
			const grant = () => {
				signal.removeEventListener("abort", abort);
				active++;
				resolve();
			};
			const abort = () => {
				const index = waiters.indexOf(grant);
				if (index >= 0) waiters.splice(index, 1);
				reject(new Error("pi_exec aborted while waiting for a call slot"));
			};
			waiters.push(grant);
			signal.addEventListener("abort", abort, { once: true });
			if (signal.aborted) abort();
		});
	};
	const release = () => {
		active--;
		waiters.shift()?.();
	};
	const progress = (operation: ExecutionOperation) => (partial: unknown) => {
		const line = resultText(partial).split("\n").find(Boolean);
		operation.activity = line?.slice(0, 120) || "running";
		onChange();
	};
	const scopeFor = (operation: ExecutionOperation, signal: AbortSignal): HostCallScope => ({
		ctx,
		signal,
		operation,
		changed: onChange,
		setChildren(next) {
			// A settled call's worker detail is final; a late child-process update cannot reopen it.
			if (!pending.has(operation)) return;
			children.set(operation, next);
			onChange();
		},
		addUsage: (usage) => usages.push(usage),
		claimAgent: () => {
			agentCalls++;
			if (agentCalls > envelope.agentBudget)
				throw new Error(`pi_exec agent budget exhausted (${envelope.agentBudget})`);
			return agentCalls - 1;
		},
		async runTool(definition, args) {
			const prepared = definition.prepareArguments ? definition.prepareArguments(args) : args;
			if (!Value.Check(definition.parameters, prepared)) {
				const issues = [...Value.Errors(definition.parameters, prepared)]
					.slice(0, 3)
					.map((issue) => `${issue.instancePath || "/"}: ${issue.message}`)
					.join("; ");
				throw new Error(`Invalid ${operation.ref} arguments: ${issues}`);
			}
			return definition.execute(
				`${toolCallId}_nested_${operation.sequence + 1}`,
				prepared as any,
				signal,
				progress(operation),
				ctx,
			);
		},
		// Pi validates, runs tool_call/tool_result hooks, and adds nested usage to pi_exec's own result.
		executeTool: (name, args) => ctx.executeTool(name, args, { signal, onUpdate: progress(operation) }),
	});

	const hostCall: ProgramHostCall = async (ref, args, signal) => {
		attempted++;
		if (attempted > envelope.callBudget) throw new Error(`pi_exec call budget exhausted (${envelope.callBudget})`);
		const fn = hostFunction(ref);
		const operation: ExecutionOperation = {
			sequence: attempted - 1,
			ref,
			args: fn?.traceArgs ? fn.traceArgs(args) : args,
			outcome: "succeeded",
		};
		operations.push(operation);
		operations.sort((left, right) => left.sequence - right.sequence);
		pending.add(operation);
		timings.set(operation, { queuedAt: Date.now() });
		onChange();
		let acquired = false;
		try {
			await acquire(signal);
			acquired = true;
			running.add(operation);
			timings.get(operation)!.startedAt = Date.now();
			onChange();
			if (!fn) throw new Error(`pi_exec does not expose ${ref}`);
			const value = await fn.run(args, scopeFor(operation, signal));
			if (value !== undefined) serializeJsonValue({ value }, "pi_exec host result");
			operation.result = fn.traceResult ? fn.traceResult(value) : traceValue(value);
			return value;
		} catch (error) {
			operation.outcome = signal.aborted ? "aborted" : "failed";
			operation.error = error instanceof Error ? error.message : String(error);
			throw error;
		} finally {
			timings.get(operation)!.finishedAt = Date.now();
			running.delete(operation);
			if (acquired) release();
			pending.delete(operation);
			delete operation.activity;
			onChange();
		}
	};

	return {
		hostCall,
		/** Calls the program attempted, including calls refused by the call budget. */
		attempted: () => attempted,
		completedOperations: () => operations.filter((operation) => !pending.has(operation)),
		activityCalls: (): ExecActivityCall[] =>
			operations.map((operation) => ({
				sequence: operation.sequence,
				ref: operation.ref,
				args: operation.args,
				status: running.has(operation) ? "running" : pending.has(operation) ? "queued" : operation.outcome,
				...timings.get(operation),
				...(operation.activity ? { activity: operation.activity } : {}),
				...(operation.result !== undefined ? { result: operation.result } : {}),
				...(operation.error ? { error: operation.error } : {}),
				...(children.has(operation) ? { children: structuredClone(children.get(operation)) } : {}),
			})),
		/** Settle calls still in flight after the program ended and return a detached copy of the trace. */
		finish(outcome: ExecutionOutcome): ExecutionOperation[] {
			if (outcome !== "succeeded") {
				for (const operation of pending) {
					operation.outcome = outcome === "failed" ? "aborted" : outcome;
					operation.error = `pi_exec ${outcome}`;
					timings.get(operation)!.finishedAt = Date.now();
					delete operation.activity;
					for (const child of children.get(operation) ?? []) {
						if (child.status !== "queued" && child.status !== "running") continue;
						child.status = operation.outcome;
						child.finishedAt = Date.now();
					}
				}
				pending.clear();
				running.clear();
			}
			return structuredClone(operations);
		},
		usage: (): Usage | undefined => (usages.length > 0 ? aggregateUsage(usages) : undefined),
	};
}
