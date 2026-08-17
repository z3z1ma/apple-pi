import { defineTool, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { type AutocompleteItem, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { getOperationsRuntime, isTuiContext } from "../../operations/src/runtime.js";
import { renderReviewProgressCard, throttleUpdates } from "../../operations/src/ui/tool-renderers.js";
import { matchingCompletions, parseArgv } from "../../shared/src/argv.js";
import { inChildSessionContext } from "../../subagents/src/child-context.js";
import { getManagedSubagentService } from "../../subagents/src/service.js";
import { ReviewController, summarizeReviewRun } from "./controller.js";
import { resolveReviewTargetRoot } from "./git.js";
import { installReviewOperationsService, reviewOperationsService } from "./operations-service.js";
import type { ReviewProfile, ReviewRun, ReviewRunSummary, ReviewSource, StartReviewOptions } from "./types.js";

const REVIEW_COMPLETION_TYPE = "review-complete";

function reviewCompletionText(run: ReviewRun): string {
	const findings = run.findings.filter((finding) => finding.validation.status !== "rejected");
	return [
		`Review completed: ${run.runId}`,
		`Root: ${run.projectRoot}`,
		`State: ${run.state}; coverage: ${run.completedItemIds.length}/${run.selected.length}; findings: ${findings.length}.`,
		...(run.metaReviews?.length ? [`Meta: ${run.metaReviews.at(-1)!.sentiment}`] : []),
		...findings
			.slice(0, 20)
			.map((finding) => `- [${finding.severity}/${finding.validation.status}] ${finding.path}: ${finding.summary}`),
		...(findings.length > 20
			? [`- ${findings.length - 20} additional findings are available in the review receipt.`]
			: []),
		`Receipt-backed result: ${summarizeReviewRun(run)}`,
	].join("\n");
}

function textResult(text: string, isError = false, details?: unknown) {
	return { content: [{ type: "text" as const, text }], isError, details };
}

function required(value: unknown, name: string): string {
	if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
	return value.trim();
}

function sourceFrom(values: Record<string, unknown>): ReviewSource {
	const mode =
		typeof values.mode === "string"
			? values.mode
			: values.commit
				? "commit"
				: values.from || values.to
					? "range"
					: "workspace";
	if (mode === "workspace") return { mode };
	if (mode === "commit") return { mode, commit: required(values.commit, "commit") };
	if (mode === "range") return { mode, from: required(values.from, "from"), to: required(values.to, "to") };
	throw new Error(`Unknown review mode: ${mode}`);
}

function collectPaths(values: Record<string, unknown>, positional: string[] = []): string[] | undefined {
	const collected: string[] = [];
	const add = (value: unknown) => {
		if (typeof value === "string" && value.trim()) collected.push(value.trim());
		else if (Array.isArray(value)) {
			for (const entry of value) if (typeof entry === "string" && entry.trim()) collected.push(entry.trim());
		}
	};
	add(values.paths);
	add(values.path);
	for (const entry of positional) add(entry);
	const unique = [...new Set(collected)];
	return unique.length ? unique : undefined;
}

function optionsFrom(values: Record<string, unknown>, positional: string[] = []): StartReviewOptions {
	const profile = typeof values.profile === "string" ? (values.profile as ReviewProfile) : undefined;
	const paths = collectPaths(values, positional);
	return {
		...(typeof values.root === "string" && values.root.trim() && { root: values.root.trim() }),
		...(paths && { paths }),
		...(profile && { profile }),
		...(typeof values.background === "string" && values.background.trim() && { background: values.background.trim() }),
		routing: {
			...(typeof values.planner_mode === "string" && { plannerMode: values.planner_mode }),
			...(typeof values.fast_mode === "string" && { fastMode: values.fast_mode }),
			...(typeof values.strong_mode === "string" && { strongMode: values.strong_mode }),
		},
	};
}

function previewText(preview: ReturnType<ReviewController["preview"]>): string {
	return [
		`Root: ${preview.projectRoot}`,
		`Source: ${preview.source.mode}`,
		`Input: ${preview.inputHash}`,
		...(preview.paths?.length ? [`Paths: ${preview.paths.join(" ")}`] : []),
		`Reviewable: ${preview.reviewable.length}`,
		...preview.reviewable.map(
			(item) => `- ${item.status}: ${item.path} (+${item.insertions}/-${item.deletions}) [${item.id.slice(0, 12)}]`,
		),
		...(preview.waived.length
			? ["Waived:", ...preview.waived.map(({ item, reason }) => `- ${item.path}: ${reason}`)]
			: []),
	].join("\n");
}

function summariesText(summaries: ReviewRunSummary[]): string {
	if (summaries.length === 0) return "No review runs for this project.";
	return summaries
		.slice(0, 20)
		.map(
			(run) =>
				`${run.runId}  ${run.state}  ${run.source.mode}/${run.profile}  coverage ${run.completed}/${run.selected}  findings ${run.findings}`,
		)
		.join("\n");
}

const REVIEW_ACTIONS: AutocompleteItem[] = [
	{ value: "run ", label: "run", description: "Run a sealed review (workspace by default)" },
	{ value: "preview ", label: "preview", description: "Show selected and waived changes without model calls" },
	{ value: "status ", label: "status", description: "List runs or inspect one run ID" },
	{ value: "stop ", label: "stop", description: "Stop an active run by ID" },
];

const TARGET_OPTION = { name: "--root", description: "Git repository or linked-worktree directory to review" };
const RUN_OPTIONS: Array<{ name: string; description: string }> = [
	{ name: "--path", description: "File, folder, or glob that limits the sealed change; repeat as leftover arguments" },
	{ name: "--profile", description: "fast, balanced, or thorough cycle count" },
	{ name: "--planner-mode", description: "Override the planner mode" },
	{ name: "--fast-mode", description: "Override the routine reviewer mode" },
	{ name: "--strong-mode", description: "Override the rigorous verifier mode" },
	{ name: "--background", description: "Behavioral contract or change background" },
];

export function reviewArgumentCompletions(prefix: string, runs: ReviewRunSummary[] = []): AutocompleteItem[] | null {
	const input = prefix.replace(/^\s+/, "");
	if (!input.includes(" ")) return matchingCompletions(input, REVIEW_ACTIONS);
	const action = input.slice(0, input.indexOf(" "));
	if (action === "status" || action === "stop") {
		const idPrefix = input.slice(action.length + 1);
		const candidates = runs
			.filter(
				(run) =>
					action === "status" ||
					!["complete", "failed", "skipped", "stopped", "workspace_conflict", "error"].includes(run.state),
			)
			.map((run) => ({
				value: `${action} ${run.runId}`,
				label: run.runId,
				description: `${run.state} · ${run.source.mode}/${run.profile} · coverage ${run.completed}/${run.selected}`,
			}));
		return matchingCompletions(`${action} ${idPrefix}`, candidates);
	}
	if (action !== "run" && action !== "preview") return null;

	const profileMatch = input.match(/^(.*--profile\s+)(\S*)$/);
	if (profileMatch) {
		return matchingCompletions(
			input,
			["fast", "balanced", "thorough"].map((profile) => ({
				value: `${profileMatch[1]}${profile} `,
				label: profile,
				description:
					profile === "fast"
						? "One cycle, tighter caps"
						: profile === "thorough"
							? "Up to three plan→review→verify cycles"
							: "One complete cycle (default)",
			})),
		);
	}

	const rest = input.slice(action.length + 1);
	if (!rest || (!rest.includes(" ") && !rest.startsWith("--"))) {
		return matchingCompletions(input, [
			{
				value: `${action} workspace `,
				label: "workspace",
				description: "Staged, unstaged, and untracked changes; add files, folders, or globs to limit scope",
			},
			{ value: `${action} range --from `, label: "range", description: "Changes between two Git refs; add --to <ref>" },
			{ value: `${action} commit --commit `, label: "commit", description: "Changes introduced by one commit" },
			...(action === "run"
				? [
						{
							value: "run --profile ",
							label: "--profile",
							description: "Review the workspace with an explicit profile",
						},
					]
				: []),
		]);
	}

	const tokens = input.trim().split(/\s+/);
	const awaitingValue = new Set([
		"--from",
		"--to",
		"--commit",
		TARGET_OPTION.name,
		...RUN_OPTIONS.map(({ name }) => name),
	]).has(tokens.at(-1) ?? "");
	if (awaitingValue) return null;
	const partial = input.endsWith(" ") ? "" : (tokens.at(-1) ?? "");
	const base = partial ? input.slice(0, -partial.length) : input;
	const options: AutocompleteItem[] = [];
	if (!tokens.includes(TARGET_OPTION.name))
		options.push({
			value: `${base}${TARGET_OPTION.name} `,
			label: TARGET_OPTION.name,
			description: TARGET_OPTION.description,
		});
	if (rest.startsWith("range ") && !tokens.includes("--to"))
		options.push({ value: `${base}--to `, label: "--to", description: "Target Git ref" });
	if (!tokens.includes("--path"))
		options.push({
			value: `${base}--path `,
			label: "--path",
			description: "File, folder, or glob that limits the sealed change; leftover arguments are more paths",
		});
	if (action === "run") {
		for (const option of RUN_OPTIONS) {
			if (option.name === "--path") continue;
			if (!tokens.includes(option.name))
				options.push({ value: `${base}${option.name} `, label: option.name, description: option.description });
		}
	}
	return matchingCompletions(input, options);
}

interface ParsedCommand {
	action: string;
	values: Record<string, string | number>;
	positional: string[];
}

function parseCommand(input: string): ParsedCommand {
	const parsed = parseArgv(input, {
		defaultAction: "run",
		actions: ["run", "preview", "status", "stop"],
		stringOptions: [
			"root",
			"path",
			"profile",
			"background",
			"planner_mode",
			"fast_mode",
			"strong_mode",
			"from",
			"to",
			"commit",
		],
		unknownOption: (rawName) => `Unknown review option: --${rawName}`,
	});
	const values = { ...parsed.options };
	const positional = [...parsed.positional];
	if (positional[0] === "workspace" || positional[0] === "range" || positional[0] === "commit")
		values.mode = positional.shift()!;
	return { action: parsed.action, values, positional };
}

function attachTui(ctx: ExtensionCommandContext): void {
	const runtime = getOperationsRuntime();
	if (runtime && isTuiContext(ctx)) runtime.widget.setUICtx(ctx.ui);
}

export default function installReview(pi: ExtensionAPI): void {
	if (inChildSessionContext()) return;
	let lifecycleEpoch = 0;
	let sessionCwd: string | undefined;
	const controller = new ReviewController({ getService: () => getManagedSubagentService(pi.events) });
	installReviewOperationsService(reviewOperationsService(controller), pi.events);
	const sourceSchema = {
		root: Type.Optional(
			Type.String({
				description:
					"Git repository or linked-worktree directory to review. Relative paths resolve from the caller cwd.",
			}),
		),
		mode: Type.Optional(Type.Union([Type.Literal("workspace"), Type.Literal("range"), Type.Literal("commit")])),
		from: Type.Optional(Type.String()),
		to: Type.Optional(Type.String()),
		commit: Type.Optional(Type.String()),
	};
	const optionSchema = {
		profile: Type.Optional(Type.Union([Type.Literal("fast"), Type.Literal("balanced"), Type.Literal("thorough")])),
		background: Type.Optional(
			Type.String({ description: "Behavioral contract or change background supplied by the caller." }),
		),
		planner_mode: Type.Optional(
			Type.String({ description: "modes.json entry for the planner; defaults to review-planner." }),
		),
		fast_mode: Type.Optional(
			Type.String({ description: "modes.json entry for reviewer intelligence; defaults to review-routine." }),
		),
		strong_mode: Type.Optional(
			Type.String({
				description: "modes.json entry for verifier intelligence; defaults to review-rigorous.",
			}),
		),
	};
	const tool = defineTool({
		name: "review",
		label: "Review",
		description:
			"Preview or run a sealed parallel code review with fresh read-only reviewers and conservative verification. Actions: preview/run/status/stop. Set root to review an agent-selected repository or linked worktree; relative roots resolve from the caller cwd. Set paths to files, folders, or globs that limit the sealed change; omit them to review the whole workspace, range, or commit. Coverage accounts selected text changes except .ledger/ history; model routes use review-planner/review-routine/review-rigorous modes and fall back to the caller model.",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("preview"), Type.Literal("run"), Type.Literal("status"), Type.Literal("stop")]),
			...sourceSchema,
			paths: Type.Optional(
				Type.Array(Type.String(), {
					description:
						"Repository-relative files, folders, or globs that limit the sealed change. Omitted reviews the whole workspace, range, or commit.",
				}),
			),
			...optionSchema,
			run_id: Type.Optional(Type.String()),
		}),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			try {
				sessionCwd = ctx.cwd;
				const root = resolveReviewTargetRoot(ctx.cwd, params.root);
				getOperationsRuntime(pi.events)?.recordOperationPointer(ctx, "review", root, params.run_id);
				if (params.action === "status") {
					const status = controller.status(root, params.run_id);
					return textResult(Array.isArray(status) ? summariesText(status) : summarizeReviewRun(status), false, status);
				}
				if (params.action === "stop") {
					const run = await controller.stop(root, required(params.run_id, "run_id"));
					return textResult(summarizeReviewRun(run), false, run);
				}
				const source = sourceFrom(params);
				const options = optionsFrom(params);
				if (params.action === "preview") {
					const preview = controller.preview(root, source, options);
					return textResult(previewText(preview), false, preview);
				}
				const push = onUpdate ? throttleUpdates(onUpdate, 200) : undefined;
				let runId: string | undefined;
				const unsub = controller.subscribeProgress((snapshot) => {
					if (!runId || snapshot.runId !== runId) return;
					push?.({ content: [{ type: "text", text: `Review ${snapshot.state}` }], details: { progress: snapshot } });
				});
				try {
					const run = await controller.run(
						ctx,
						source,
						{
							...options,
							onStarted: (started) => {
								runId = started.runId;
								getOperationsRuntime(pi.events)?.recordOperationPointer(
									ctx,
									"review",
									started.projectRoot,
									started.runId,
								);
							},
						},
						signal,
					);
					return textResult(summarizeReviewRun(run), run.state === "failed" || run.state === "error", run);
				} finally {
					unsub();
				}
			} catch (error) {
				return textResult(error instanceof Error ? error.message : String(error), true);
			}
		},
		renderCall(args, theme) {
			return new Text(
				`${theme.fg("toolTitle", theme.bold("Review "))}${theme.fg("accent", args.action)} ${theme.fg("dim", args.mode ?? args.run_id ?? "workspace")}`,
				0,
				0,
			);
		},
		renderResult(result, options, theme) {
			const details = result.details as { progress?: import("./types.js").ReviewProgressSnapshot } | undefined;
			if (details?.progress) return renderReviewProgressCard(details.progress, theme, options.isPartial) as never;
			const content = result.content[0]?.type === "text" ? result.content[0].text : "No output";
			return new Text(theme.fg("dim", content), 0, 0);
		},
	});
	pi.registerTool(tool);

	pi.registerCommand("review", {
		description: "Preview, run, inspect, or stop a sealed parallel code review",
		getArgumentCompletions: (prefix) => {
			let runs: ReviewRunSummary[] = [];
			if (/^(?:status|stop)\s/.test(prefix) && sessionCwd) {
				try {
					const status = controller.status(sessionCwd);
					if (Array.isArray(status)) runs = status;
				} catch {
					// Command/action completions remain available outside a Git repository.
				}
			}
			return reviewArgumentCompletions(prefix, runs);
		},
		handler: async (input, ctx) => {
			try {
				sessionCwd = ctx.cwd;
				attachTui(ctx);
				if (!input.trim()) {
					const runtime = getOperationsRuntime(pi.events);
					if (runtime) await runtime.openHub(ctx, "review");
					else ctx.ui.notify("Harness hub is not available.", "error");
					return;
				}
				const parsed = parseCommand(input);
				if (parsed.action === "status") {
					const status = controller.status(
						resolveReviewTargetRoot(ctx.cwd, typeof parsed.values.root === "string" ? parsed.values.root : undefined),
						parsed.positional[0],
					);
					ctx.ui.notify(Array.isArray(status) ? summariesText(status) : summarizeReviewRun(status), "info");
					return;
				}
				if (parsed.action === "stop") {
					const run = await controller.stop(
						resolveReviewTargetRoot(ctx.cwd, typeof parsed.values.root === "string" ? parsed.values.root : undefined),
						required(parsed.positional[0], "run-id"),
					);
					ctx.ui.notify(summarizeReviewRun(run), "warning");
					return;
				}
				if (parsed.action !== "run" && parsed.action !== "preview") {
					throw new Error(
						"Usage: /review [run|preview] [workspace|range|commit] [PATH|GLOB|FOLDER...] [--path SPEC] [--root PATH] [--from REF --to REF | --commit REF] [--profile fast|balanced|thorough] | status [run-id] [--root PATH] | stop <run-id> [--root PATH]",
					);
				}
				const source = sourceFrom(parsed.values);
				const options = optionsFrom(parsed.values, parsed.positional);
				if (parsed.action === "preview") {
					const root = resolveReviewTargetRoot(
						ctx.cwd,
						typeof parsed.values.root === "string" ? parsed.values.root : undefined,
					);
					getOperationsRuntime(pi.events)?.recordOperationPointer(ctx, "review", root);
					ctx.ui.notify(previewText(controller.preview(root, source, options)), "info");
					return;
				}
				ctx.ui.notify(
					"Review started. Changes to the selected input before completion will invalidate the run.",
					"info",
				);
				const launchEpoch = lifecycleEpoch;
				let resolveStarted: () => void = () => {};
				const started = new Promise<void>((resolve) => {
					resolveStarted = resolve;
				});
				const pending = controller.run(ctx, source, {
					...options,
					onStarted: (run) => {
						getOperationsRuntime(pi.events)?.recordOperationPointer(ctx, "review", run.projectRoot, run.runId);
						resolveStarted();
					},
				});
				void pending.catch(() => resolveStarted());
				await Promise.race([pending, started]);
				void pending.then(
					(run) => {
						ctx.ui.notify(
							summarizeReviewRun(run),
							run.state === "complete" || run.state === "skipped" ? "info" : "warning",
						);
						if (launchEpoch === lifecycleEpoch) {
							pi.sendMessage(
								{ customType: REVIEW_COMPLETION_TYPE, content: reviewCompletionText(run), display: true, details: run },
								{ deliverAs: "followUp", triggerTurn: true },
							);
						}
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
		lifecycleEpoch++;
		await controller.stopAll();
	});
	pi.on("session_shutdown", async () => {
		lifecycleEpoch++;
		await controller.stopAll();
	});
}
