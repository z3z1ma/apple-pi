import { Text, type AutocompleteItem } from "@earendil-works/pi-tui";
import { defineTool, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { inChildSessionContext } from "../../subagents/src/child-context.js";
import { getManagedSubagentService } from "../../subagents/src/service.js";
import { ReviewController, summarizeReviewRun } from "./controller.js";
import { resolveReviewTargetRoot } from "./git.js";
import type { ReviewProfile, ReviewRun, ReviewRunSummary, ReviewSource, StartReviewOptions } from "./types.js";

const WIDGET_ID = "review-run";

function textResult(text: string, isError = false, details?: unknown) {
	return { content: [{ type: "text" as const, text }], isError, details };
}

function required(value: unknown, name: string): string {
	if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
	return value.trim();
}

function sourceFrom(values: Record<string, unknown>): ReviewSource {
	const mode = typeof values.mode === "string" ? values.mode : values.commit ? "commit" : values.from || values.to ? "range" : "workspace";
	if (mode === "workspace") return { mode };
	if (mode === "commit") return { mode, commit: required(values.commit, "commit") };
	if (mode === "range") return { mode, from: required(values.from, "from"), to: required(values.to, "to") };
	throw new Error(`Unknown review mode: ${mode}`);
}

function optionsFrom(values: Record<string, unknown>): StartReviewOptions {
	const profile = typeof values.profile === "string" ? values.profile as ReviewProfile : undefined;
	return {
		...(typeof values.root === "string" && values.root.trim() && { root: values.root.trim() }),
		...(profile && { profile }),
		...(typeof values.background === "string" && values.background.trim() && { background: values.background.trim() }),
		routing: {
			...(typeof values.planner_mode === "string" && { plannerMode: values.planner_mode }),
			...(typeof values.fast_mode === "string" && { fastMode: values.fast_mode }),
			...(typeof values.strong_mode === "string" && { strongMode: values.strong_mode }),
		},
		budgets: {
			...(typeof values.max_tokens === "number" && { maxTokens: values.max_tokens }),
			...(typeof values.timeout_seconds === "number" && { timeoutSeconds: values.timeout_seconds }),
			...(typeof values.concurrency === "number" && { maxConcurrency: values.concurrency }),
			...(typeof values.max_groups === "number" && { maxGroups: values.max_groups }),
			...(typeof values.planner_max_turns === "number" && { plannerMaxTurns: values.planner_max_turns }),
			...(typeof values.reviewer_max_turns === "number" && { reviewerMaxTurns: values.reviewer_max_turns }),
			...(typeof values.verifier_max_turns === "number" && { verifierMaxTurns: values.verifier_max_turns }),
			...(typeof values.max_prompt_kb === "number" && { maxPromptBytes: values.max_prompt_kb * 1024 }),
		},
	};
}

function previewText(preview: ReturnType<ReviewController["preview"]>): string {
	return [
		`Root: ${preview.projectRoot}`,
		`Source: ${preview.source.mode}`,
		`Input: ${preview.inputHash}`,
		`Reviewable: ${preview.reviewable.length}`,
		...preview.reviewable.map((item) => `- ${item.status}: ${item.path} (+${item.insertions}/-${item.deletions}) [${item.id.slice(0, 12)}]`),
		...(preview.waived.length ? ["Waived:", ...preview.waived.map(({ item, reason }) => `- ${item.path}: ${reason}`)] : []),
	].join("\n");
}

function summariesText(summaries: ReviewRunSummary[]): string {
	if (summaries.length === 0) return "No review runs for this project.";
	return summaries.slice(0, 20).map((run) =>
		`${run.runId}  ${run.state}  ${run.source.mode}/${run.profile}  coverage ${run.completed}/${run.selected}  findings ${run.findings}`,
	).join("\n");
}

const REVIEW_ACTIONS: AutocompleteItem[] = [
	{ value: "run ", label: "run", description: "Run a sealed review (workspace by default)" },
	{ value: "preview ", label: "preview", description: "Show selected and waived changes without model calls" },
	{ value: "status ", label: "status", description: "List runs or inspect one run ID" },
	{ value: "stop ", label: "stop", description: "Stop an active run by ID" },
];

const TARGET_OPTION = { name: "--root", description: "Git repository or linked-worktree directory to review" };
const RUN_OPTIONS: Array<{ name: string; description: string }> = [
	{ name: "--profile", description: "fast, balanced, or thorough model routing" },
	{ name: "--planner-mode", description: "Override the semantic-grouping mode" },
	{ name: "--fast-mode", description: "Override the ordinary-review mode" },
	{ name: "--strong-mode", description: "Override the high-risk review mode" },
	{ name: "--concurrency", description: "Maximum parallel review groups" },
	{ name: "--max-tokens", description: "Aggregate review token budget" },
	{ name: "--timeout-seconds", description: "Whole-run timeout" },
	{ name: "--max-groups", description: "Maximum semantic groups" },
];

function matchingCompletions(prefix: string, items: AutocompleteItem[]): AutocompleteItem[] | null {
	const matches = items.filter((item) => item.value.startsWith(prefix));
	return matches.length ? matches : null;
}

export function reviewArgumentCompletions(prefix: string, runs: ReviewRunSummary[] = []): AutocompleteItem[] | null {
	const input = prefix.replace(/^\s+/, "");
	if (!input.includes(" ")) return matchingCompletions(input, REVIEW_ACTIONS);
	const action = input.slice(0, input.indexOf(" "));
	if (action === "status" || action === "stop") {
		const idPrefix = input.slice(action.length + 1);
		const candidates = runs
			.filter((run) => action === "status" || !["complete", "failed", "skipped", "stopped", "workspace_conflict", "error"].includes(run.state))
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
		return matchingCompletions(input, ["fast", "balanced", "thorough"].map((profile) => ({
			value: `${profileMatch[1]}${profile} `,
			label: profile,
			description: profile === "balanced" ? "Fast review with strong escalation (default)" : `Force ${profile} review routing`,
		})));
	}

	const rest = input.slice(action.length + 1);
	if (!rest || (!rest.includes(" ") && !rest.startsWith("--"))) {
		return matchingCompletions(input, [
			{ value: `${action} workspace `, label: "workspace", description: "Staged, unstaged, and untracked changes" },
			{ value: `${action} range --from `, label: "range", description: "Changes between two Git refs; add --to <ref>" },
			{ value: `${action} commit --commit `, label: "commit", description: "Changes introduced by one commit" },
			...(action === "run" ? [{ value: "run --profile ", label: "--profile", description: "Review the workspace with an explicit profile" }] : []),
		]);
	}

	const tokens = input.trim().split(/\s+/);
	const awaitingValue = new Set(["--from", "--to", "--commit", TARGET_OPTION.name, ...RUN_OPTIONS.map(({ name }) => name)]).has(tokens.at(-1) ?? "");
	if (awaitingValue) return null;
	const partial = input.endsWith(" ") ? "" : tokens.at(-1) ?? "";
	const base = partial ? input.slice(0, -partial.length) : input;
	const options: AutocompleteItem[] = [];
	if (!tokens.includes(TARGET_OPTION.name)) options.push({ value: `${base}${TARGET_OPTION.name} `, label: TARGET_OPTION.name, description: TARGET_OPTION.description });
	if (rest.startsWith("range ") && !tokens.includes("--to")) options.push({ value: `${base}--to `, label: "--to", description: "Target Git ref" });
	if (action === "run") {
		for (const option of RUN_OPTIONS) {
			if (!tokens.includes(option.name)) options.push({ value: `${base}${option.name} `, label: option.name, description: option.description });
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
	const tokens = input.match(/"[^"]*"|'[^']*'|\S+/g)?.map((token) => token.replace(/^(?:"(.*)"|'(.*)')$/, "$1$2")) ?? [];
	const first = tokens[0];
	const action = first && !first.startsWith("--") ? tokens.shift()! : "run";
	const values: Record<string, string | number> = {};
	const positional: string[] = [];
	const numeric = new Set(["max_tokens", "timeout_seconds", "concurrency", "max_groups", "planner_max_turns", "reviewer_max_turns", "verifier_max_turns", "max_prompt_kb"]);
	for (let index = 0; index < tokens.length; index++) {
		const token = tokens[index];
		if (!token.startsWith("--")) {
			positional.push(token);
			continue;
		}
		const [raw, inline] = token.slice(2).split("=", 2);
		const name = raw.replace(/-/g, "_");
		const value = inline ?? tokens[++index];
		if (value === undefined) throw new Error(`--${raw} requires a value`);
		if (numeric.has(name)) {
			const number = Number(value);
			if (!Number.isFinite(number)) throw new Error(`--${raw} requires a number`);
			values[name] = number;
		} else values[name] = value;
	}
	if (positional[0] === "workspace" || positional[0] === "range" || positional[0] === "commit") values.mode = positional.shift()!;
	return { action, values, positional };
}

function setWidget(ctx: ExtensionCommandContext, run?: ReviewRun): void {
	if (!ctx.hasUI) return;
	if (!run) {
		ctx.ui.setWidget(WIDGET_ID, undefined);
		return;
	}
	ctx.ui.setWidget(WIDGET_ID, [
		`Review ${run.state} · ${run.source.mode}/${run.profile} · coverage ${run.completedItemIds.length}/${run.selected.length}`,
		`Findings ${run.findings.filter((finding) => finding.validation.status !== "rejected").length} · tokens ${run.totalTokens}/${run.budgets.maxTokens}`,
	], { placement: "aboveEditor" });
}

export default function installReview(pi: ExtensionAPI): void {
	if (inChildSessionContext()) return;
	const controller = new ReviewController({ getService: () => getManagedSubagentService(pi.events) });
	const sourceSchema = {
		root: Type.Optional(Type.String({ description: "Git repository or linked-worktree directory to review. Relative paths resolve from the caller cwd." })),
		mode: Type.Optional(Type.Union([Type.Literal("workspace"), Type.Literal("range"), Type.Literal("commit")])),
		from: Type.Optional(Type.String()),
		to: Type.Optional(Type.String()),
		commit: Type.Optional(Type.String()),
	};
	const optionSchema = {
		profile: Type.Optional(Type.Union([Type.Literal("fast"), Type.Literal("balanced"), Type.Literal("thorough")])),
		background: Type.Optional(Type.String({ description: "Behavioral contract or change background supplied by the caller." })),
		planner_mode: Type.Optional(Type.String({ description: "modes.json entry for semantic grouping; defaults to review-planner." })),
		fast_mode: Type.Optional(Type.String({ description: "modes.json entry for ordinary review groups." })),
		strong_mode: Type.Optional(Type.String({ description: "modes.json entry for high-risk review groups." })),
		max_tokens: Type.Optional(Type.Number({ minimum: 10000, maximum: 10000000 })),
		timeout_seconds: Type.Optional(Type.Number({ minimum: 60, maximum: 86400 })),
		concurrency: Type.Optional(Type.Number({ minimum: 1, maximum: 16 })),
		max_groups: Type.Optional(Type.Number({ minimum: 1, maximum: 128 })),
		planner_max_turns: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
		reviewer_max_turns: Type.Optional(Type.Number({ minimum: 1, maximum: 200 })),
		verifier_max_turns: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
		max_prompt_kb: Type.Optional(Type.Number({ minimum: 32, maximum: 2048 })),
	};
	const tool = defineTool({
		name: "review",
		label: "Review",
		description: "Preview or run a sealed, semantically grouped, parallel code review with fresh read-only reviewers and conservative verification. Actions: preview/run/status/stop. Set root to review an agent-selected repository or linked worktree; relative roots resolve from the caller cwd. Every changed text item is coverage-accounted; model routes use review-planner/review-fast/review-strong modes and fall back to the caller model.",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("preview"), Type.Literal("run"), Type.Literal("status"), Type.Literal("stop")]),
			...sourceSchema,
			...optionSchema,
			run_id: Type.Optional(Type.String()),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			try {
				if (params.action === "status") {
					const status = controller.status(resolveReviewTargetRoot(ctx.cwd, params.root), params.run_id);
					return textResult(Array.isArray(status) ? summariesText(status) : summarizeReviewRun(status), false, status);
				}
				if (params.action === "stop") {
					const run = await controller.stop(resolveReviewTargetRoot(ctx.cwd, params.root), required(params.run_id, "run_id"));
					return textResult(summarizeReviewRun(run), false, run);
				}
				const source = sourceFrom(params);
				if (params.action === "preview") {
					const preview = controller.preview(resolveReviewTargetRoot(ctx.cwd, params.root), source);
					return textResult(previewText(preview), false, preview);
				}
				const run = await controller.run(ctx, source, optionsFrom(params), signal);
				return textResult(summarizeReviewRun(run), run.state === "failed" || run.state === "error", run);
			} catch (error) {
				return textResult(error instanceof Error ? error.message : String(error), true);
			}
		},
		renderCall(args, theme) {
			return new Text(`${theme.fg("toolTitle", theme.bold("Review "))}${theme.fg("accent", args.action)} ${theme.fg("dim", args.mode ?? args.run_id ?? "workspace")}`, 0, 0);
		},
		renderResult(result, _options, theme) {
			const content = result.content[0]?.type === "text" ? result.content[0].text : "No output";
			return new Text(theme.fg("dim", content), 0, 0);
		},
	});
	pi.registerTool(tool);

	pi.registerCommand("review", {
		description: "Preview, run, inspect, or stop a semantically grouped parallel code review",
		getArgumentCompletions: (prefix) => {
			let runs: ReviewRunSummary[] = [];
			if (/^(?:status|stop)\s/.test(prefix)) {
				try {
					const status = controller.status(process.cwd());
					if (Array.isArray(status)) runs = status;
				} catch {
					// Command/action completions remain available outside a Git repository.
				}
			}
			return reviewArgumentCompletions(prefix, runs);
		},
		handler: async (input, ctx) => {
			try {
				const parsed = parseCommand(input);
				if (parsed.action === "status") {
					const status = controller.status(resolveReviewTargetRoot(ctx.cwd, typeof parsed.values.root === "string" ? parsed.values.root : undefined), parsed.positional[0]);
					ctx.ui.notify(Array.isArray(status) ? summariesText(status) : summarizeReviewRun(status), "info");
					return;
				}
				if (parsed.action === "stop") {
					const run = await controller.stop(resolveReviewTargetRoot(ctx.cwd, typeof parsed.values.root === "string" ? parsed.values.root : undefined), required(parsed.positional[0], "run-id"));
					setWidget(ctx, run);
					ctx.ui.notify(summarizeReviewRun(run), "warning");
					return;
				}
				if (parsed.action !== "run" && parsed.action !== "preview") {
					throw new Error("Usage: /review [run|preview] [workspace|range|commit] [--root PATH] [--from REF --to REF | --commit REF] [--profile fast|balanced|thorough] | status [run-id] [--root PATH] | stop <run-id> [--root PATH]");
				}
				const source = sourceFrom(parsed.values);
				if (parsed.action === "preview") {
					const root = resolveReviewTargetRoot(ctx.cwd, typeof parsed.values.root === "string" ? parsed.values.root : undefined);
					ctx.ui.notify(previewText(controller.preview(root, source)), "info");
					return;
				}
				ctx.ui.setWidget(WIDGET_ID, [`Review planning · ${source.mode}`, "Sealing input and building semantic work graph…"], { placement: "aboveEditor" });
				ctx.ui.notify("Review started. Changes to the selected input before completion will invalidate the run.", "info");
				void controller.run(ctx, source, optionsFrom(parsed.values)).then((run) => {
					setWidget(ctx, run);
					ctx.ui.notify(summarizeReviewRun(run), run.state === "complete" || run.state === "skipped" ? "info" : "warning");
				}, (error) => {
					setWidget(ctx, undefined);
					ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
				});
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	pi.on("session_before_switch", async () => controller.stopAll());
	pi.on("session_shutdown", async () => controller.stopAll());
}
