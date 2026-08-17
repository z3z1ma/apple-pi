import { defineTool, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { type AutocompleteItem, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { getOperationsRuntime, isTuiContext } from "../../operations/src/runtime.js";
import { renderRalphProgressCard, throttleUpdates } from "../../operations/src/ui/tool-renderers.js";
import { completeUnusedFlags, matchingCompletions, parseArgv } from "../../shared/src/argv.js";
import { inChildSessionContext } from "../../subagents/src/child-context.js";
import { getManagedSubagentService } from "../../subagents/src/service.js";
import { RalphController, type StartRunOptions, summarizeRun } from "./controller.js";
import { installRalphOperationsService, ralphOperationsService } from "./operations-service.js";
import { resolveRalphRoots } from "./roots.js";
import type { RunSummary } from "./types.js";
import { compileWorkGraph } from "./work-graph.js";

function textResult(text: string, isError = false, details?: unknown) {
	return { content: [{ type: "text" as const, text }], isError, details };
}

function requireString(value: unknown, name: string): string {
	if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
	return value.trim();
}

function summariesText(summaries: RunSummary[]): string {
	if (summaries.length === 0) return "No Ralph runs for this project.";
	return summaries
		.slice(0, 20)
		.map(
			(run) =>
				`${run.runId}  ${run.state}  iteration ${run.iteration}  ${run.taskPath}\n  ledger: ${run.ledgerRoot}${run.lastOutcome ? `\n  ${run.lastOutcome}` : ""}`,
		)
		.join("\n");
}

export function inspectionText(graph: ReturnType<typeof compileWorkGraph>): string {
	const workItems = graph.task.taskDocument?.workItems ?? [];
	const visibleWorkItems = workItems.slice(0, 20);
	const workItemSummary = [
		`${workItems.length} total`,
		`${workItems.filter((item) => item.state === "open").length} open`,
		...(visibleWorkItems.length === 0 ? [] : [visibleWorkItems.map((item) => `${item.id} (${item.state})`).join(", ")]),
		...(workItems.length > visibleWorkItems.length ? [`${workItems.length - visibleWorkItems.length} omitted`] : []),
	].join("; ");
	return [
		`Workspace: ${graph.projectRoot}`,
		`Ledger: ${graph.ledgerRoot}`,
		`Task: ${graph.task.path}`,
		`Status: ${graph.task.status}`,
		`Graph: ${graph.graphHash}`,
		`Context: ${graph.byteLength} bytes across ${graph.records.length} records`,
		`Acceptance: ${graph.criteria.map((criterion) => criterion.id).join(", ")}`,
		`Work Items: ${workItemSummary}`,
		"Records:",
		...graph.records.map((record) => `- ${record.kind}: ${record.path} (${record.digest.slice(0, 12)})`),
	].join("\n");
}

function inspectText(cwd: string, task: string, root?: string, ledgerRoot?: string): string {
	const roots = resolveRalphRoots(cwd, root, ledgerRoot);
	return inspectionText(compileWorkGraph(roots.workspaceRoot, task, roots.ledgerRoot));
}

function optionsFromParams(params: Record<string, unknown>): StartRunOptions {
	return {
		...(typeof params.root === "string" && params.root.trim() && { root: params.root.trim() }),
		...(typeof params.ledger_root === "string" &&
			params.ledger_root.trim() && { ledgerRoot: params.ledger_root.trim() }),
	};
}

function parseCommandArgs(input: string) {
	return parseArgv(input, {
		defaultAction: "status",
		actions: ["inspect", "start", "step", "run", "status", "stop"],
		stringOptions: ["root", "ledger_root"],
		unknownOption: (rawName) => `Unknown Ralph option: --${rawName}`,
	});
}

const RALPH_ACTIONS: AutocompleteItem[] = [
	{ value: "inspect ", label: "inspect", description: "Validate and summarize a ledger task without starting agents" },
	{ value: "start ", label: "start", description: "Create a persisted step-mode run without executing an iteration" },
	{ value: "step ", label: "step", description: "Execute at most one iteration of an existing run" },
	{ value: "run ", label: "run", description: "Start and execute an autonomous task loop" },
	{ value: "status ", label: "status", description: "List runs or inspect one run ID" },
	{ value: "stop ", label: "stop", description: "Stop a nonterminal run by ID" },
];

const RALPH_RUN_OPTIONS: Array<{ name: string; description: string }> = [
	{ name: "--root", description: "Implementation root in a linked Git worktree" },
	{ name: "--ledger-root", description: "Linked checkout containing authoritative .ledger" },
];

const RALPH_TERMINAL_STATES = new Set([
	"done",
	"blocked",
	"evidence_failed",
	"review_failed",
	"workspace_conflict",
	"authority_required",
	"budget_exhausted",
	"compacted",
	"interrupted",
	"stopped",
	"error",
]);

export function ralphArgumentCompletions(prefix: string, runs: RunSummary[] = []): AutocompleteItem[] | null {
	const input = prefix.replace(/^\s+/, "");
	if (!input.includes(" ")) return matchingCompletions(input, RALPH_ACTIONS);
	const action = input.slice(0, input.indexOf(" "));
	if (action === "status" || action === "step" || action === "stop") {
		const idPrefix = input.slice(action.length + 1);
		const candidates = runs
			.filter(
				(run) =>
					action === "status" ||
					(action === "step"
						? run.state === "ready" || run.state === "iterating"
						: !RALPH_TERMINAL_STATES.has(run.state)),
			)
			.map((run) => ({
				value: `${action} ${run.runId}`,
				label: run.runId,
				description: `${run.state} · iteration ${run.iteration} · ${run.taskPath}`,
			}));
		return matchingCompletions(`${action} ${idPrefix}`, candidates);
	}
	if (action === "inspect") return null;
	if (action !== "start" && action !== "run") return null;

	const rest = input.slice(action.length + 1);
	if (!rest || (!rest.includes(" ") && !rest.startsWith("--"))) return null;
	return completeUnusedFlags(
		input,
		RALPH_RUN_OPTIONS,
		RALPH_RUN_OPTIONS.map(({ name }) => name),
	);
}

function attachTui(ctx: ExtensionCommandContext): void {
	const runtime = getOperationsRuntime();
	if (runtime && isTuiContext(ctx)) runtime.widget.setUICtx(ctx.ui);
}

export default function installRalph(pi: ExtensionAPI): void {
	if (inChildSessionContext()) return;
	let sessionCwd: string | undefined;
	const controller = new RalphController({ getService: () => getManagedSubagentService(pi.events) });
	installRalphOperationsService(ralphOperationsService(controller), pi.events);

	const tool = defineTool({
		name: "ralph",
		label: "Ralph",
		description:
			"Orchestrate deterministic ledger task loops with fresh executors, independent review, and closure judges. The optional root targets a linked Git worktree; ledger_root selects the linked checkout whose .ledger is authoritative. Actions: inspect/start/step/run/status/stop. Runs never push, deploy, commit, reset, or resume an agent, and they do not abort for token, turn, or elapsed-time ceilings.",
		parameters: Type.Object({
			action: Type.Union([
				Type.Literal("inspect"),
				Type.Literal("start"),
				Type.Literal("step"),
				Type.Literal("run"),
				Type.Literal("status"),
				Type.Literal("stop"),
			]),
			task: Type.Optional(
				Type.String({ description: "Path relative to ledger_root, normally .ledger/<task-id>/task.md." }),
			),
			run_id: Type.Optional(Type.String()),
			root: Type.Optional(
				Type.String({
					description:
						"Implementation worktree root, absolute or relative to the session repository. Defaults to the session worktree.",
				}),
			),
			ledger_root: Type.Optional(
				Type.String({ description: "Linked checkout root containing the authoritative .ledger. Defaults to root." }),
			),
		}),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			try {
				sessionCwd = ctx.cwd;
				if (!ctx.isProjectTrusted()) throw new Error("Ralph requires a trusted session repository");
				if (params.ledger_root && !["inspect", "start", "run"].includes(params.action))
					throw new Error("ledger_root is valid only for inspect, start, and run");
				if (params.action === "inspect")
					return textResult(inspectText(ctx.cwd, requireString(params.task, "task"), params.root, params.ledger_root));
				const workspaceRoot = resolveRalphRoots(ctx.cwd, params.root).workspaceRoot;
				getOperationsRuntime(pi.events)?.recordOperationPointer(ctx, "ralph", workspaceRoot, params.run_id);
				if (params.action === "status") {
					const status = controller.status(workspaceRoot, params.run_id);
					return textResult(Array.isArray(status) ? summariesText(status) : summarizeRun(status));
				}
				if (params.action === "stop") {
					const run = await controller.stop(workspaceRoot, requireString(params.run_id, "run_id"));
					return textResult(summarizeRun(run));
				}
				const push = onUpdate ? throttleUpdates(onUpdate, 200) : undefined;
				let runId = params.run_id;
				const unsub = controller.subscribeProgress((snapshot) => {
					if (!runId || snapshot.runId !== runId) return;
					push?.({ content: [{ type: "text", text: `Ralph ${snapshot.state}` }], details: { progress: snapshot } });
				});
				try {
					if (params.action === "start") {
						const run = await controller.start(ctx, requireString(params.task, "task"), optionsFromParams(params));
						runId = run.runId;
						getOperationsRuntime(pi.events)?.recordOperationPointer(ctx, "ralph", run.projectRoot, run.runId);
						return textResult(summarizeRun(run));
					}
					if (params.action === "step") {
						const run = await controller.step(ctx, requireString(params.run_id, "run_id"), signal, workspaceRoot);
						return textResult(summarizeRun(run));
					}
					const started = await controller.start(ctx, requireString(params.task, "task"), {
						...optionsFromParams(params),
						mode: "auto",
					});
					runId = started.runId;
					getOperationsRuntime(pi.events)?.recordOperationPointer(ctx, "ralph", started.projectRoot, started.runId);
					const run = await controller.continue(
						ctx,
						started.runId,
						Number.POSITIVE_INFINITY,
						signal,
						started.projectRoot,
					);
					return textResult(summarizeRun(run));
				} finally {
					unsub();
				}
			} catch (error) {
				return textResult(error instanceof Error ? error.message : String(error), true);
			}
		},
		renderCall(args, theme) {
			return new Text(
				`${theme.fg("toolTitle", theme.bold("Ralph "))}${theme.fg("accent", args.action)} ${theme.fg("dim", args.task ?? args.run_id ?? "")}`,
				0,
				0,
			);
		},
		renderResult(result, options, theme) {
			const details = result.details as { progress?: import("./types.js").RalphProgressSnapshot } | undefined;
			if (details?.progress) return renderRalphProgressCard(details.progress, theme, options.isPartial) as never;
			const content = result.content[0]?.type === "text" ? result.content[0].text : "No output";
			return new Text(theme.fg("dim", content), 0, 0);
		},
	});
	pi.registerTool(tool);

	pi.registerCommand("ralph", {
		description: "Inspect, start, step, run, stop, or view a bounded ledger-backed Ralph loop",
		getArgumentCompletions: async (prefix) => {
			let runs: RunSummary[] = [];
			if (/^(?:status|step|stop)\s/.test(prefix.trimStart()) && sessionCwd) {
				try {
					const status = controller.status(sessionCwd);
					if (Array.isArray(status)) runs = status;
				} catch {
					// Action help still works outside a Ralph project.
				}
			}
			return ralphArgumentCompletions(prefix, runs);
		},
		handler: async (input, ctx) => {
			try {
				sessionCwd = ctx.cwd;
				attachTui(ctx);
				if (!input.trim()) {
					const runtime = getOperationsRuntime(pi.events);
					if (runtime) await runtime.openHub(ctx, "ralph");
					else ctx.ui.notify("Harness hub is not available.", "error");
					return;
				}
				if (!ctx.isProjectTrusted()) throw new Error("Ralph requires a trusted session repository");
				const parsed = parseCommandArgs(input);
				const expectedPositionals =
					parsed.action === "status"
						? [0, 1]
						: ["inspect", "start", "step", "run", "stop"].includes(parsed.action)
							? [1]
							: [];
				if (!expectedPositionals.includes(parsed.positional.length))
					throw new Error(`Unexpected arguments for /ralph ${parsed.action}`);
				if (!["inspect", "start", "run"].includes(parsed.action) && parsed.options.ledger_root)
					throw new Error("--ledger-root is valid only for inspect, start, and run");
				const params = parsed.options as Record<string, unknown>;
				const workspaceRoot = resolveRalphRoots(
					ctx.cwd,
					typeof params.root === "string" ? params.root : undefined,
				).workspaceRoot;
				if (parsed.action === "inspect") {
					ctx.ui.notify(
						inspectText(
							ctx.cwd,
							requireString(parsed.positional[0], "task"),
							typeof params.root === "string" ? params.root : undefined,
							typeof params.ledger_root === "string" ? params.ledger_root : undefined,
						),
						"info",
					);
					return;
				}
				if (parsed.action === "status") {
					const status = controller.status(workspaceRoot, parsed.positional[0]);
					ctx.ui.notify(Array.isArray(status) ? summariesText(status) : summarizeRun(status), "info");
					return;
				}
				if (parsed.action === "stop") {
					const run = await controller.stop(workspaceRoot, requireString(parsed.positional[0], "run-id"));
					ctx.ui.notify(summarizeRun(run), "warning");
					return;
				}
				if (parsed.action === "start") {
					const run = await controller.start(
						ctx,
						requireString(parsed.positional[0], "task"),
						optionsFromParams(params),
					);
					getOperationsRuntime(pi.events)?.recordOperationPointer(ctx, "ralph", run.projectRoot, run.runId);
					ctx.ui.notify(summarizeRun(run), "info");
					return;
				}
				if (parsed.action !== "step" && parsed.action !== "run") {
					throw new Error(
						"Usage: /ralph inspect <task.md> | start <task.md> | step <run-id> | run <task.md> [--root PATH] [--ledger-root PATH] | status [run-id] | stop <run-id>",
					);
				}
				ctx.ui.notify(`Ralph ${parsed.action} started. Do not mutate this checkout until it finishes.`, "info");
				const operation =
					parsed.action === "step"
						? controller.step(ctx, requireString(parsed.positional[0], "run-id"), undefined, workspaceRoot)
						: (async () => {
								const run = await controller.start(ctx, requireString(parsed.positional[0], "task"), {
									...optionsFromParams(params),
									mode: "auto",
								});
								getOperationsRuntime(pi.events)?.recordOperationPointer(ctx, "ralph", run.projectRoot, run.runId);
								return controller.continue(ctx, run.runId, Number.POSITIVE_INFINITY, undefined, run.projectRoot);
							})();
				void operation.then(
					(run) => {
						ctx.ui.notify(summarizeRun(run), run.state === "done" ? "info" : "warning");
					},
					(error) => {
						ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
					},
				);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	pi.on("session_start", (_event, ctx) => {
		sessionCwd = ctx.cwd;
	});
	pi.on("session_before_switch", async () => {
		await controller.stopAll();
	});
	pi.on("session_shutdown", async () => {
		await controller.stopAll();
	});
}
