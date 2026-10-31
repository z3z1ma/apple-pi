import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { OverlayHandle, TUI } from "@earendil-works/pi-tui";
import { openCapturedSignOff } from "../../browser-pages/src/captured-review.js";
import { openInBrowser } from "../../browser-pages/src/open-browser.js";
import { sendCommand } from "../../session-state/src/client.js";
import {
	readReview,
	readReviewFreshness,
	readReviewPart,
	readReviewSource,
	reviewQueue,
	withReviews,
} from "../../session-state/src/review-read.js";
import { resolveToolPath } from "../../shared/src/tool-path.js";
import type { ReviewOperation } from "./operations.js";
import { CaptureConfirmation, ReviewPanel } from "./panel.js";
import { evidenceLines, findingLines, previewLines, sourceLines, summaryLines } from "./presentation.js";
import { previewReview } from "./preview.js";
import type { ReviewAssessment, ReviewSummary } from "./results.js";
import type { ReviewTarget } from "./types.js";

const views = [
	"summary",
	"target",
	"source",
	"plan",
	"findings",
	"coverage",
	"attempts",
	"decisions",
	"configuration",
	"freshness",
] as const;
type EvidenceView = (typeof views)[number];
type EvidenceDetail = { lines: string[]; nextOffset: number | null };
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
	private sourceSelection: { review: string; path?: string; side: "before" | "after" } | undefined;
	private sourcePage:
		| {
				key: string;
				stop: AbortController;
				detail: EvidenceDetail;
		  }
		| undefined;

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
				if (!current || current.handle.isHidden()) return;
				if (current.handle.isFocused()) current.handle.unfocus();
				else current.handle.focus();
				current.tui.requestRender();
			},
		});
		const reset = () => {
			this.close();
			this.selected = undefined;
			this.sourceSelection = undefined;
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
								title: this.view[0]!.toUpperCase() + this.view.slice(1),
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
					view: (direction) => {
						this.stopSource();
						this.view = views[(views.indexOf(this.view) + direction + views.length) % views.length]!;
						this.mounted?.panel.resetDetail();
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
		this.stopSource();
		this.action?.abort();
		this.action = undefined;
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
	): EvidenceDetail {
		if (this.view === "summary") return { lines: summaryLines(review), nextOffset: null };
		if (this.view === "source" || this.view === "freshness") return this.sourceDetail(actor, review, limit, offset);
		const data = readReviewPart(db, actor, review.id, { part: this.view, limit, offset });
		if (this.view === "findings") {
			const findings = data as {
				total: number;
				page: { rows: ReviewAssessment["findings"]; nextOffset: number | null };
			};
			return {
				lines: [
					`${findings.total} reported findings. Responses do not repair this captured code.`,
					"",
					...(findings.page.rows.length
						? findings.page.rows.flatMap(findingLines)
						: ["None reported; this is not a clean-review claim."]),
				],
				nextOffset: findings.page.nextOffset,
			};
		}
		const paged = (
			this.view === "target"
				? (data as { target?: { omissions?: unknown } | null }).target?.omissions
				: this.view === "plan"
					? (data as { chunks?: unknown }).chunks
					: data
		) as { page?: { nextOffset: number | null } } | null;
		return {
			lines: [`${this.view} | ${review.id} | revision ${review.revision}`, "", ...evidenceLines(data)],
			nextOffset: paged?.page?.nextOffset ?? null,
		};
	}

	private stopSource(): void {
		this.sourcePage?.stop.abort();
		this.sourcePage = undefined;
	}

	private sourceDetail(actor: string, review: ReviewSummary, limit: number, offset: number) {
		const selected = this.sourceSelection?.review === review.id ? this.sourceSelection : undefined;
		const options = { path: selected?.path, side: selected?.side ?? "after", limit, offset } as const;
		const view = this.view;
		const key = JSON.stringify([view, review.id, review.digest, options]);
		if (this.sourcePage?.key === key) return this.sourcePage.detail;
		this.stopSource();
		const mounted = this.mounted;
		const pending: EvidenceDetail = {
			lines: [view === "freshness" ? "Checking live applicability..." : "Loading retained source..."],
			nextOffset: null,
		};
		if (!mounted) return pending;
		const page = { key, stop: new AbortController(), detail: pending };
		this.sourcePage = page;
		void (
			view === "freshness"
				? readReviewFreshness(actor, review.id, page.stop.signal).then((data) => ({
						lines: evidenceLines(data),
						nextOffset: null,
					}))
				: readReviewSource(actor, review.id, options, page.stop.signal).then((data) => ({
						lines: sourceLines(data),
						nextOffset: data.page?.nextOffset ?? null,
					}))
		)
			.then((detail) => {
				if (this.sourcePage !== page || page.stop.signal.aborted || this.mounted !== mounted) return;
				page.detail = detail;
				mounted.panel.refresh();
			})
			.catch((error) => {
				if (this.sourcePage !== page || page.stop.signal.aborted || this.mounted !== mounted) return;
				page.detail = {
					lines: [`Source read failed: ${error instanceof Error ? error.message : String(error)}`],
					nextOffset: null,
				};
				mounted.panel.refresh();
			});
		return page.detail;
	}

	private async chooseSource(ctx: ExtensionContext, review: ReviewSummary | undefined, stop: AbortSignal) {
		if (!review) {
			this.mounted?.panel.setNote("Select a review before browsing its source.");
			return;
		}
		const side = await ctx.ui.select("Captured comparison side", ["after", "before"], { signal: stop });
		if (!side || stop.aborted) return;
		const path = await ctx.ui.input("Captured file path (blank lists files)", "Repository-relative path", {
			signal: stop,
		});
		if (path === undefined || stop.aborted) return;
		this.sourceSelection = { review: review.id, path: path || undefined, side: side as "before" | "after" };
		this.stopSource();
		this.view = "source";
		this.mounted?.panel.resetDetail();
	}

	private async runAction(run: (stop: AbortSignal) => Promise<void>): Promise<void> {
		if (this.action) return;
		const mounted = this.mounted;
		if (!mounted) return;
		const controller = new AbortController();
		this.action = controller;
		mounted.handle.unfocus();
		mounted.handle.setHidden(true);
		try {
			await run(controller.signal);
		} catch (error) {
			if (!controller.signal.aborted) mounted.panel.setNote(error instanceof Error ? error.message : String(error));
		} finally {
			if (this.action === controller) this.action = undefined;
			if (this.mounted === mounted && !controller.signal.aborted) {
				mounted.handle.setHidden(false);
				mounted.panel.refresh();
				mounted.handle.focus();
			}
		}
	}

	private async menu(ctx: ExtensionContext, review: ReviewSummary | undefined, stop: AbortSignal): Promise<void> {
		withReviews(() => true);
		const actions = ["Capture a review", ...(this.pending.size ? ["Recover an uncertain request"] : [])];
		if (review) {
			actions.push("Choose captured source");
			if (!["completed", "cancelled", "no-changes"].includes(review.state)) actions.push("Cancel", "Set priority");
			if (["interrupted", "failed", "incomplete"].includes(review.state)) actions.push("Resume same target");
			if (["completed", "incomplete", "failed", "interrupted", "cancelled"].includes(review.state))
				actions.push("Authorize additional work", "Open captured sign-off");
			actions.push("Capture a fresh rerun", "Reassign");
		}
		const choice = await ctx.ui.select("Review actions", actions, { signal: stop });
		if (!choice || stop.aborted) return;
		if (choice === "Choose captured source") return this.chooseSource(ctx, review, stop);
		if (choice === "Authorize additional work" && review) return this.authorizeWork(ctx, review, stop);
		if (choice === "Open captured sign-off" && review) {
			const page = await openCapturedSignOff(ctx.sessionManager.getSessionId(), review.id, stop);
			openInBrowser(page.url);
			try {
				const receipt = await page.result;
				this.mounted?.panel.setNote(`Operator verdict recorded: ${receipt.result.verdict}. Saved ${receipt.saved}`);
			} finally {
				page.close();
			}
			return;
		}
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
		const confirmed = await this.confirmOperation(ctx, choice, operation, stop);
		if (confirmed && !stop.aborted) await this.send(`review-ui:${randomUUID()}`, confirmed, stop);
	}

	private async authorizeWork(ctx: ExtensionContext, review: ReviewSummary, stop: AbortSignal): Promise<void> {
		const question = await ctx.ui.input("Additional review question", "Concrete uncertainty to resolve", {
			signal: stop,
		});
		if (!question?.trim() || stop.aborted) return;
		const reason = await ctx.ui.input("Why is more work justified?", "New risk, disagreement or missing evidence", {
			signal: stop,
		});
		if (!reason?.trim() || stop.aborted) return;
		const doneWhen = await ctx.ui.input("What evidence settles this question?", "A concrete stopping condition", {
			signal: stop,
		});
		if (!doneWhen?.trim() || stop.aborted) return;
		if (
			!(await ctx.ui.confirm(
				"Authorize new reviewer work?",
				"Replan this retained target with the additional question. Required inspections run again and can incur model cost; live edits are not captured.",
				{ signal: stop },
			)) ||
			stop.aborted
		)
			return;
		await this.send(
			`review-ui:${randomUUID()}`,
			{
				action: "extend",
				review: review.id,
				digest: review.digest!,
				revision: review.revision,
				question,
				reason,
				doneWhen,
			},
			stop,
		);
		return;
	}

	private async confirmOperation(
		ctx: ExtensionContext,
		choice: string,
		operation: ReviewOperation,
		stop: AbortSignal,
	): Promise<ReviewOperation | undefined> {
		let confirmation: string;
		if (operation.action === "enqueue") {
			this.mounted?.handle.setHidden(false);
			this.mounted?.panel.setNote("Capturing target preview; this request has not started reviewers.");
			const preview = await previewReview(operation.request, stop);
			if (stop.aborted) return;
			if (!preview.changes.length) {
				this.mounted?.panel.setNote("No changed paths in the selected comparison and scope; nothing was queued.");
				return;
			}
			operation = { ...operation, expectedDigest: preview.digest };
			confirmation = `${previewLines(preview).join("\n")}\n\nQueue independent reviewers for this exact identity. Model usage can incur cost; coverage and approval are not inherited. Admission captures again and refuses any changed identity.`;
		} else {
			confirmation = `${operation.review}\n${operation.action === "priority" ? `Set priority to ${operation.priority}.` : operation.action === "reassign" ? `Assign responsibility to ${operation.owner}.` : `Apply ${operation.action} to this recorded review.`}`;
		}
		if (this.pending.size)
			confirmation += "\nAn earlier request is still uncertain. Recover it to avoid repeating work.";
		const confirmed =
			operation.action === "enqueue"
				? await this.confirmCapture(ctx, confirmation.split("\n"), stop)
				: await ctx.ui.confirm(choice, confirmation, { signal: stop });
		if (!confirmed && !stop.aborted && operation.action === "enqueue")
			this.mounted?.panel.setNote("Capture cancelled; this request was not queued.");
		return confirmed && !stop.aborted ? operation : undefined;
	}

	private async confirmCapture(ctx: ExtensionContext, lines: string[], stop: AbortSignal): Promise<boolean> {
		if (stop.aborted) return false;
		let finish!: (confirmed: boolean) => void;
		const answer = new Promise<boolean>((resolve) => {
			finish = resolve;
		});
		const mounted: { handle?: OverlayHandle } = {};
		const queue = this.mounted;
		queue?.handle.setHidden(true);
		const abort = () => finish(false);
		stop.addEventListener("abort", abort, { once: true });
		try {
			await ctx.ui.custom<undefined>((tui, theme, keys, done) => {
				if (!stop.aborted)
					mounted.handle = tui.showOverlay(new CaptureConfirmation(tui, theme, lines, finish, keys), {
						anchor: "center",
						width: "90%",
						maxHeight: "80%",
					});
				done(undefined);
				return { render: () => [], invalidate: () => {} };
			});
			if (stop.aborted) return false;
			mounted.handle?.focus();
			return await answer;
		} finally {
			stop.removeEventListener("abort", abort);
			mounted.handle?.hide();
			if (this.mounted === queue && !stop.aborted) queue?.handle.setHidden(false);
		}
	}

	private async send(request: string, operation: ReviewOperation, stop: AbortSignal): Promise<void> {
		this.pending.set(request, operation);
		this.mounted?.handle.setHidden(false);
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
		const directory = await ctx.ui.input("Repository or worktree directory", ctx.cwd, { signal: stop });
		if (directory === undefined || stop.aborted) return;
		const cwd = resolveToolPath(directory.trim() || ctx.cwd, ctx.cwd);
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
			request: { cwd, target, ...(intent.trim() ? { intent: { path: intent.trim() } } : {}) },
		};
	}
}

export function installReviewPanel(pi: ExtensionAPI): void {
	new ReviewManager(pi);
}
