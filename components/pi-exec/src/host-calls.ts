import { homedir } from "node:os";
import type { Usage } from "@earendil-works/pi-ai";
import type { ExtensionToolContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";
import { loadSearchRootGuardConfig } from "../../home-search-guard/src/config.js";
import { searchRootBlockReason } from "../../home-search-guard/src/index.js";
import { agentOperationArgs, runAgentWorker } from "./agent-workers.js";
import { type CoreToolName, coreToolDefinition, ENVELOPE_TOOL_NAMES, isCoreToolName } from "./core-tools.js";
import type { ProgramEnvelope } from "./envelope.js";
import { EVIDENCE_FUNCTION_NAMES, runEvidenceFunction } from "./evidence.js";
import { executeFetch, fetchOperationArgs, traceFetchUrl } from "./fetch.js";
import { serializeJsonValue } from "./json.js";
import { aggregateUsage, bounded, resultText, traceValue } from "./results.js";
import { listSkills, readSkillBody } from "./skills.js";
import { capturedTool, capturedTools } from "./tool-capture.js";
import type { ExecutionOperation, ExecutionOutcome, ProgramHostCall } from "./types.js";
import type { ExecActivityCall } from "./ui.js";

const MAX_GUEST_TOOL_RESULT_CHARS = 50_000;

type Args = Record<string, unknown>;

interface HostCallScope {
	ctx: ExtensionToolContext;
	signal: AbortSignal;
	operation: ExecutionOperation;
	/** Publish a change to the operation's trace or activity. */
	changed(): void;
	runTool(definition: ToolDefinition<any, any>, args: Args): Promise<any>;
	claimAgent(): number;
	addUsage(usage: Usage): void;
	extensionTools(): ReturnType<typeof capturedTools>;
}

/** One host function the program can call, keyed by the ref that program.ts sends. */
interface HostFunction {
	/** Trace and activity arguments; defaults to the raw arguments. Never include bound payloads. */
	traceArgs?(args: Args): Args;
	run(args: Args, scope: HostCallScope): unknown;
	/** Trace result; defaults to a bounded copy of the value. */
	traceResult?(value: unknown): unknown;
}

function portableValue(value: unknown): unknown {
	if (value === undefined) return undefined;
	const json = serializeJsonValue(value, "pi_exec host result");
	if (json.length <= MAX_GUEST_TOOL_RESULT_CHARS) return JSON.parse(json) as unknown;
	return { truncated: true, originalChars: json.length, preview: json.slice(0, MAX_GUEST_TOOL_RESULT_CHARS) };
}

/** TypeBox schemas carry runtime metadata; the program receives their JSON Schema projection. */
function portableSchema(value: unknown): unknown {
	const json = JSON.stringify(value);
	if (json === undefined) return undefined;
	return JSON.parse(json) as unknown;
}

const stringArg = (args: Args, key: string): string => (typeof args[key] === "string" ? (args[key] as string) : "");

function toolDescriptors(scope: HostCallScope, withParameters = false) {
	return scope.extensionTools().map((tool) => ({
		name: tool.name,
		description: tool.description,
		...(withParameters ? { parameters: portableSchema(tool.parameters) } : {}),
	}));
}

const HOST_FUNCTIONS: Record<string, HostFunction> = {
	fetch: {
		traceArgs: fetchOperationArgs,
		run: (args, scope) => executeFetch(args, scope.signal),
		traceResult: (value) => {
			if (!value || typeof value !== "object") return traceValue(value);
			const response = value as Args;
			return { status: response.status, url: traceFetchUrl(response.url), bodyBytes: response.bodyBytes };
		},
	},
	"tools.list": { run: (_args, scope) => toolDescriptors(scope) },
	"tools.search": {
		run: (args, scope) => {
			const query = stringArg(args, "query").toLowerCase();
			return toolDescriptors(scope).filter((tool) => `${tool.name} ${tool.description}`.toLowerCase().includes(query));
		},
	},
	"tools.describe": {
		run: (args, scope) => toolDescriptors(scope, true).find((tool) => tool.name === stringArg(args, "name")),
	},
	"tools.call": {
		async run(args, scope) {
			scope.extensionTools();
			const name = stringArg(args, "name");
			const toolArgs =
				args.args && typeof args.args === "object" && !Array.isArray(args.args) ? (args.args as Args) : {};
			const tool = capturedTool(name);
			if (!tool) throw new Error(`Unknown extension tool: ${name || "(missing name)"}`);
			scope.operation.ref = `extensions.${name}`;
			scope.operation.args = toolArgs;
			scope.changed();
			const result = await scope.runTool(tool.definition, toolArgs);
			const content = portableValue(result.content);
			const details = portableValue(result.details);
			return {
				text: bounded(resultText(result), MAX_GUEST_TOOL_RESULT_CHARS, `${scope.operation.ref} output`).value,
				...(content !== undefined ? { content } : {}),
				...(details !== undefined ? { details } : {}),
				...(result.usage ? { usage: result.usage } : {}),
			};
		},
	},
	"skills.list": { run: (_args, scope) => listSkills({ cwd: scope.ctx.cwd }) },
	"skills.body": { run: (args, scope) => readSkillBody(stringArg(args, "name"), { cwd: scope.ctx.cwd }) },
	"agent.run": {
		traceArgs: agentOperationArgs,
		async run(args, scope) {
			const result = await runAgentWorker(scope.claimAgent(), args, scope.ctx, scope.signal, (activity) => {
				scope.operation.activity = activity;
				scope.changed();
			});
			if (result.usage) scope.addUsage(result.usage);
			scope.operation.children = result.operations;
			if (result.error) {
				scope.operation.outcome = "failed";
				scope.operation.error = result.error;
			}
			return result.record;
		},
	},
};

function evidenceFunction(name: string): HostFunction {
	const run: HostFunction["run"] = (args, scope) =>
		runEvidenceFunction(name, args, { cwd: scope.ctx.cwd, signal: scope.signal });
	if (!name.startsWith("context_")) return { run };
	return {
		run,
		traceArgs: (args) =>
			Object.fromEntries(
				Object.entries(args).map(([key, value]) => [key, key === "value" || key === "items" ? { bound: true } : value]),
			),
		traceResult: () => ({ bound: true }),
	};
}

function coreToolFunction(name: CoreToolName): HostFunction {
	const ref = `pi.${name}`;
	return {
		async run(args, scope) {
			try {
				const config = loadSearchRootGuardConfig(scope.ctx.cwd, scope.ctx.isProjectTrusted?.() ?? false);
				const blocked = searchRootBlockReason(name, args, scope.ctx.cwd, { home: homedir(), ...config });
				if (blocked) throw new Error(blocked);
				const result = await scope.runTool(coreToolDefinition(name, scope.ctx.cwd), args);
				const text = bounded(resultText(result), MAX_GUEST_TOOL_RESULT_CHARS, `${ref} output`).value;
				return ENVELOPE_TOOL_NAMES.has(name) ? { ok: true, output: text } : text;
			} catch (error) {
				if (!ENVELOPE_TOOL_NAMES.has(name) || scope.signal.aborted) throw error;
				const output = error instanceof Error ? error.message : String(error);
				scope.operation.outcome = "failed";
				scope.operation.error = output;
				return { ok: false, output: bounded(output, MAX_GUEST_TOOL_RESULT_CHARS, `${ref} output`).value };
			}
		},
	};
}

function hostFunction(ref: string): HostFunction | undefined {
	if (Object.hasOwn(HOST_FUNCTIONS, ref)) return HOST_FUNCTIONS[ref];
	if (ref.startsWith("evidence.")) {
		const name = ref.slice("evidence.".length);
		if (EVIDENCE_FUNCTION_NAMES.includes(name as (typeof EVIDENCE_FUNCTION_NAMES)[number]))
			return evidenceFunction(name);
	}
	if (ref.startsWith("pi.")) {
		const name = ref.slice("pi.".length);
		if (isCoreToolName(name)) return coreToolFunction(name);
	}
	return undefined;
}

export interface HostCallsOptions {
	ctx: ExtensionToolContext;
	toolCallId: string;
	envelope: ProgramEnvelope;
	/** Why Pi's registered-tool catalog could not be captured, if it could not. */
	captureError: string | undefined;
	onChange(): void;
}

/**
 * Serve one program run's host calls: enforce the call, agent, and concurrency budgets, run the host function,
 * and keep the operation trace, activity rows, and nested usage.
 */
export function createHostCalls(options: HostCallsOptions) {
	const { ctx, toolCallId, envelope, captureError, onChange } = options;
	const operations: ExecutionOperation[] = [];
	const pending = new Set<ExecutionOperation>();
	const running = new Set<ExecutionOperation>();
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
	const extensionTools = () => {
		if (captureError) throw new Error(`extension tools unavailable: ${captureError}`);
		const tools = capturedTools();
		if (tools.length === 0)
			throw new Error("extension tools unavailable: Pi's registered-tool catalog was not captured");
		return tools;
	};
	const scopeFor = (operation: ExecutionOperation, signal: AbortSignal): HostCallScope => ({
		ctx,
		signal,
		operation,
		changed: onChange,
		extensionTools,
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
			const result = await definition.execute(
				`${toolCallId}_nested_${operation.sequence + 1}`,
				prepared as any,
				signal,
				(partial) => {
					const progress = resultText(partial).split("\n").find(Boolean);
					operation.activity = progress?.slice(0, 120) || "running";
					onChange();
				},
				ctx,
			);
			if (result.usage) usages.push(result.usage);
			return result;
		},
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
		onChange();
		let acquired = false;
		try {
			await acquire(signal);
			acquired = true;
			running.add(operation);
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
				...(operation.activity ? { activity: operation.activity } : {}),
				...(operation.result !== undefined ? { result: operation.result } : {}),
				...(operation.error ? { error: operation.error } : {}),
			})),
		/** Settle calls still in flight after the program ended and return a detached copy of the trace. */
		finish(outcome: ExecutionOutcome): ExecutionOperation[] {
			if (outcome !== "succeeded") {
				for (const operation of pending) {
					operation.outcome = outcome === "failed" ? "aborted" : outcome;
					operation.error = `pi_exec ${outcome}`;
				}
				pending.clear();
				running.clear();
			}
			return structuredClone(operations);
		},
		usage: (): Usage | undefined => (usages.length > 0 ? aggregateUsage(usages) : undefined),
	};
}
