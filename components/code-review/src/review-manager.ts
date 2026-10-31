import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { OverlayHandle, TUI } from "@earendil-works/pi-tui";
import { sendCommand } from "../../session-state/src/client.js";
import { readReview, readReviewPart, reviewQueue, withReviews } from "../../session-state/src/review-read.js";
import type { ReviewOperation } from "./operations.js";
import { ReviewPanel } from "./panel.js";
import { evidenceLines, summaryLines, targetLabel } from "./presentation.js";
import type { ReviewSummary } from "./results.js";
import type { ReviewTarget } from "./types.js";

const views = ["summary", "target", "plan", "findings", "coverage", "attempts", "decisions"] as const;
type EvidenceView = (typeof views)[number];
type Mounted = {
	panel: ReviewPanel;
	handle: OverlayHandle;
	tui: TUI;
	timer: ReturnType<typeof setInterval>;
	ctx: ExtensionContext;
};

export class ReviewManager {
	private mounted: Mounted | undefined;
	private selected: string | undefined;
	private view: EvidenceView = "summary";
	private action: AbortController | undefined;
	private readonly pending = new Map<string, ReviewOperation>();

	constructor(pi: ExtensionAPI) {
		pi.registerCommand("reviews", {
			description: "Open the captured review queue and its evidence",
			handler: async (_args, ctx) => this.open(ctx),
		});
		pi.registerShortcut("ctrl+w", {
			description: "Toggle the review queue",
			handler: async (ctx) => {
				if (this.mounted) this.close();
				else await this.open(ctx);
			},
		});
		pi.registerShortcut("alt+g", {
			description: "Move focus between the editor and review queue",
			handler: () => {
				const current = this.mounted;
				if (!current) return;
				if (current.handle.isFocused()) current.handle.unfocus();
				else current.handle.focus();
				current.tui.requestRender();
			},
		});
		const reset = () => {
			this.action?.abort();
			this.action = undefined;
			this.close();
			this.selected = undefined;
			this.pending.clear();
		};
		pi.on("session_start", reset);
		pi.on("session_shutdown", reset);
		pi.on("session_before_switch", reset);
		pi.on("session_before_fork", reset);
		pi.on("session_before_tree", reset);
	}

	async open(ctx: ExtensionContext): Promise<void> {
		if (!ctx.hasUI || ctx.mode !== "tui") return;
		if (this.mounted) {
			this.mounted.handle.focus();
			this.mounted.tui.requestRender();
			return;
		}
		await ctx.ui.custom<undefined>((tui, theme, _keys, done) => {
			const actor = ctx.sessionManager.getSessionId();
			const panel = new ReviewPanel(
				tui,
				theme,
				(options) =>
					withReviews((db) => {
						const queue = reviewQueue(db, actor, options);
						const review = queue.page?.rows.find((row) => row.id === options.around) ?? queue.page?.rows[0];
						const offset = review?.id === options.around ? options.detailOffset : 0;
						return {
							queue,
							selected: review?.id,
							detail: {
								...(review
									? this.detail(db, actor, review, options.detailLimit, offset)
									: { lines: ["No review selected."], nextOffset: null }),
								offset,
							},
						};
					}),
				{
					close: () => this.close(),
					unfocus: () => this.mounted?.handle.unfocus(),
					menu: (review) => {
						void this.runAction((stop) => this.menu(ctx, review, stop));
					},
					view: () => {
						void this.runAction(async (stop) => {
							const choice = await ctx.ui.select("Review evidence", [...views], { signal: stop });
							if (!choice || stop.aborted) return;
							this.view = choice as EvidenceView;
							this.mounted?.panel.resetDetail();
						});
					},
				},
				this.selected,
			);
			const handle = tui.showOverlay(panel, {
				nonCapturing: true,
				anchor: "top-center",
				width: "90%",
				maxHeight: "80%",
			});
			const timer = setInterval(() => panel.refresh(), 500);
			timer.unref();
			this.mounted = { panel, handle, tui, timer, ctx };
			done(undefined);
			return { render: () => [], invalidate: () => {} };
		});
		this.focus();
	}

	private focus(): void {
		this.mounted?.handle.focus();
		this.mounted?.tui.requestRender();
	}

	close(): void {
		const current = this.mounted;
		this.mounted = undefined;
		if (!current) return;
		this.selected = current.panel.getSelectedId();
		clearInterval(current.timer);
		current.handle.hide();
	}

	private detail(
		db: DatabaseSync,
		actor: string,
		review: ReviewSummary,
		limit: number,
		offset: number,
	): { lines: string[]; nextOffset: number | null } {
		if (this.view === "summary") return { lines: summaryLines(review), nextOffset: null };
		const data = readReviewPart(db, actor, review.id, { part: this.view, limit, offset });
		const paged = (
			this.view === "target"
				? (data as { omissions?: unknown }).omissions
				: this.view === "plan"
					? (data as { chunks?: unknown }).chunks
					: data
		) as { page?: { nextOffset: number | null } } | null;
		return {
			lines: [`${this.view} | ${review.id} | revision ${review.revision}`, "", ...evidenceLines(data)],
			nextOffset: paged?.page?.nextOffset ?? null,
		};
	}

	private async runAction(run: (stop: AbortSignal) => Promise<void>): Promise<void> {
		if (this.action) return;
		const mounted = this.mounted;
		if (!mounted) return;
		const controller = new AbortController();
		this.action = controller;
		mounted.handle.unfocus();
		try {
			await run(controller.signal);
		} catch (error) {
			if (!controller.signal.aborted) mounted.panel.setNote(error instanceof Error ? error.message : String(error));
		} finally {
			if (this.action === controller) this.action = undefined;
			if (this.mounted === mounted && !controller.signal.aborted) {
				mounted.panel.refresh();
				mounted.handle.focus();
			}
		}
	}

	private async menu(ctx: ExtensionContext, review: ReviewSummary | undefined, stop: AbortSignal): Promise<void> {
		withReviews(() => true);
		const actions = ["Capture a review", ...(this.pending.size ? ["Recover an uncertain request"] : [])];
		if (review) {
			if (!["completed", "cancelled"].includes(review.state)) actions.push("Cancel", "Set priority");
			if (["interrupted", "failed", "incomplete"].includes(review.state)) actions.push("Resume same target");
			actions.push("Capture a fresh rerun", "Reassign");
		}
		const choice = await ctx.ui.select("Review actions", actions, { signal: stop });
		if (!choice || stop.aborted) return;
		if (choice === "Recover an uncertain request") {
			const request = await ctx.ui.select(
				"Replay the original request (same arguments and identity)",
				[...this.pending.keys()],
				{ signal: stop },
			);
			const original = request && this.pending.get(request);
			if (request && original && !stop.aborted) await this.send(request, original, stop);
			return;
		}
		let operation: ReviewOperation | undefined;
		if (choice === "Capture a review") operation = await this.capture(ctx, stop);
		else if (review) {
			const job = withReviews((db) => readReview(db, ctx.sessionManager.getSessionId(), review.id));
			if (choice === "Cancel") operation = { action: "cancel", review: job.id };
			else if (choice === "Resume same target") operation = { action: "resume", review: job.id };
			else if (choice === "Capture a fresh rerun")
				operation = {
					action: "enqueue",
					request: job.request,
					owner: ctx.sessionManager.getSessionId(),
					parent: job.id,
				};
			else if (choice === "Set priority") {
				const value = await ctx.ui.input("Queue priority (higher goes first)", String(job.priority), { signal: stop });
				if (value === undefined) return;
				const priority = Number(value);
				if (!value.trim() || !Number.isSafeInteger(priority)) throw new Error("Priority must be a safe integer");
				operation = { action: "priority", review: job.id, priority };
			} else if (choice === "Reassign") {
				const owner = await ctx.ui.input("New lasting owner's person ID", job.owner, { signal: stop });
				if (!owner?.trim()) return;
				operation = { action: "reassign", review: job.id, owner: owner.trim() };
			}
		}
		if (!operation || stop.aborted) return;
		if (
			!(await ctx.ui.confirm(
				choice,
				`${operation.action === "enqueue" ? `${operation.request.cwd}: ${targetLabel(operation.request.target)}\nCapture a new target and queue independent reviewers. Model usage can incur cost; coverage and approval are not inherited.` : `${operation.review}\n${operation.action === "priority" ? `Set priority to ${operation.priority}.` : operation.action === "reassign" ? `Assign responsibility to ${operation.owner}.` : `Apply ${operation.action} to this recorded review.`}`}${this.pending.size ? "\nAn earlier request is still uncertain. Recover it to avoid repeating work." : ""}`,
				{ signal: stop },
			)) ||
			stop.aborted
		)
			return;
		await this.send(`review-ui:${randomUUID()}`, operation, stop);
	}

	private async send(request: string, operation: ReviewOperation, stop: AbortSignal): Promise<void> {
		this.pending.set(request, operation);
		this.mounted?.panel.setNote(`Request ${request}: waiting for the runtime`);
		try {
			const receipt = await sendCommand(
				"operator",
				{ kind: "review", version: 1, operation },
				{ commandId: request, signal: stop },
			);
			if (!stop.aborted && ["applied", "failed"].includes(receipt.stage)) this.pending.delete(request);
			if (!stop.aborted)
				this.mounted?.panel.setNote(
					`Request ${request}: ${receipt.stage}${receipt.reason ? ` - ${receipt.reason}` : ""}. Admission is not review completion.`,
				);
		} catch (error) {
			throw new Error(
				`Request ${request}: outcome unknown. Inspect this handle before another request. ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	private async capture(
		ctx: ExtensionContext,
		stop: AbortSignal,
	): Promise<Extract<ReviewOperation, { action: "enqueue" }> | undefined> {
		const kind = await ctx.ui.select(
			"Capture which comparison?",
			["working-tree", "staged", "commit", "range", "branch"],
			{ signal: stop },
		);
		if (!kind || stop.aborted) return;
		const input = (title: string, placeholder: string) => ctx.ui.input(title, placeholder, { signal: stop });
		let target: ReviewTarget;
		if (kind === "staged") target = { kind: "staged" };
		else if (kind === "commit") {
			const commit = await input("Commit", "HEAD");
			if (commit === undefined || stop.aborted) return;
			const parent = await input("Parent comparison (blank for a non-merge commit)", "");
			if (parent === undefined || stop.aborted) return;
			target = { kind: "commit", commit: commit.trim() || "HEAD", ...(parent.trim() ? { parent: parent.trim() } : {}) };
		} else {
			const base = await input("Comparison base", "HEAD");
			if (base === undefined || stop.aborted) return;
			if (kind === "working-tree") target = { kind, base: base.trim() || "HEAD" };
			else {
				const head = await input("Comparison head", "HEAD");
				if (head === undefined || stop.aborted) return;
				target = { kind: kind as "range" | "branch", base: base.trim() || "HEAD", head: head.trim() || "HEAD" };
			}
		}
		const intent = await input("Approved intent file (blank leaves intent unassessed)", "");
		if (intent === undefined || stop.aborted) return;
		return {
			action: "enqueue",
			owner: ctx.sessionManager.getSessionId(),
			request: { cwd: ctx.cwd, target, ...(intent.trim() ? { intent: { path: intent.trim() } } : {}) },
		};
	}
}

export function installReviewPanel(pi: ExtensionAPI): void {
	new ReviewManager(pi);
}
