import type { CatalogTask } from "../../../ralph/src/catalog.js";
import { ralphProgressIdentity } from "../../../ralph/src/progress.js";
import type { RalphProgressSnapshot } from "../../../ralph/src/types.js";
import { reviewProgressIdentity } from "../../../review/src/progress.js";
import type { ReviewProgressSnapshot } from "../../../review/src/types.js";
import { SnapshotProjection } from "../progress-channel.js";
import type { ActiveTaskProjection } from "../session-state.js";
import { clampLines } from "./bounded-lines.js";
import { formatDuration, formatTokens, isLiveState, oneLine, SPINNER, type Theme, terminalGlyph } from "./format.js";

const WIDGET_ID = "harness";
const STATUS_KEY = "harness";
const MAX_LINES = 14;
const TICK_MS = 400;
const LINGER_MS = 8_000;

export type WidgetUICtx = {
	setStatus(key: string, text: string | undefined): void;
	setWidget(
		key: string,
		content:
			| undefined
			| ((tui: any, theme: Theme) => { render(width?: number): string[]; invalidate(): void; dispose?(): void }),
		options?: { placement?: "aboveEditor" | "belowEditor" },
	): void;
};

export interface CompactWidgetModel {
	activeTask: ActiveTaskProjection;
	catalogTask?: CatalogTask;
	reviews: ReviewProgressSnapshot[];
	ralph: RalphProgressSnapshot[];
}

interface Linger {
	ralph: Map<string, number>;
	reviews: Map<string, number>;
}

export class CompactOperationsWidget {
	private ui: WidgetUICtx | undefined;
	private tui: { terminal?: { columns?: number }; requestRender?: () => void } | undefined;
	private registered = false;
	private timer: ReturnType<typeof setInterval> | undefined;
	private frame = 0;
	private lastStatus: string | undefined;
	private model: CompactWidgetModel = { activeTask: {}, reviews: [], ralph: [] };
	private readonly linger: Linger = { ralph: new Map(), reviews: new Map() };
	private readonly ralphProjection = new SnapshotProjection(ralphProgressIdentity);
	private readonly reviewProjection = new SnapshotProjection(reviewProgressIdentity);
	private projectionError: string | undefined;

	setUICtx(ctx: WidgetUICtx | undefined): void {
		if (ctx === this.ui) return;
		this.ui = ctx;
		this.registered = false;
		this.tui = undefined;
		this.lastStatus = undefined;
		if (ctx) this.update();
	}

	applyRalph(snapshot: RalphProgressSnapshot): void {
		const result = this.ralphProjection.apply(snapshot);
		if (!result.ok) this.projectionError = result.error;
		else if (this.projectionError?.includes(snapshot.runId)) this.projectionError = undefined;
		if (!isLiveState(snapshot.state)) this.linger.ralph.set(snapshot.runId, Date.now());
		else this.linger.ralph.delete(snapshot.runId);
		this.refreshModel();
	}

	applyReview(snapshot: ReviewProgressSnapshot): void {
		const result = this.reviewProjection.apply(snapshot);
		if (!result.ok) this.projectionError = result.error;
		else if (this.projectionError?.includes(snapshot.runId)) this.projectionError = undefined;
		if (!isLiveState(snapshot.state)) this.linger.reviews.set(snapshot.runId, Date.now());
		else this.linger.reviews.delete(snapshot.runId);
		this.refreshModel();
	}

	setActiveTask(activeTask: ActiveTaskProjection, catalogTask?: CatalogTask): void {
		this.model = { ...this.model, activeTask, catalogTask };
		this.update();
	}

	private refreshModel(): void {
		const now = Date.now();
		const ralph = this.ralphProjection
			.list()
			.filter((snapshot) => this.visible(snapshot.state, this.linger.ralph.get(snapshot.runId), now));
		const reviews = this.reviewProjection
			.list()
			.filter((snapshot) => this.visible(snapshot.state, this.linger.reviews.get(snapshot.runId), now));
		this.model = { ...this.model, ralph, reviews };
		this.update();
	}

	private visible(state: string, lingeredAt: number | undefined, now: number): boolean {
		if (isLiveState(state)) return true;
		return lingeredAt !== undefined && now - lingeredAt < LINGER_MS;
	}

	ensureTimer(): void {
		if (!this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
	}

	private tick(): void {
		this.frame++;
		this.refreshModel();
	}

	update(): void {
		if (!this.ui) return;
		const liveRalph = this.model.ralph.filter((snapshot) => isLiveState(snapshot.state));
		const liveReviews = this.model.reviews.filter((snapshot) => isLiveState(snapshot.state));
		const hasTask = Boolean(this.model.activeTask.pointer);
		const hasFinished = this.model.ralph.length + this.model.reviews.length > liveRalph.length + liveReviews.length;
		if (!hasTask && liveRalph.length === 0 && liveReviews.length === 0 && !hasFinished) {
			this.clear();
			return;
		}
		this.ensureTimer();
		const status = liveStatus(liveRalph, liveReviews);
		if (status !== this.lastStatus) {
			this.ui.setStatus(STATUS_KEY, status);
			this.lastStatus = status;
		}
		if (!this.registered) {
			this.ui.setWidget(
				WIDGET_ID,
				(tui, theme) => {
					this.tui = tui;
					return {
						render: (width?: number) => this.render(theme, width ?? tui.terminal?.columns ?? 80),
						invalidate: () => {
							this.registered = false;
							this.tui = undefined;
						},
					};
				},
				{ placement: "aboveEditor" },
			);
			this.registered = true;
		} else {
			this.tui?.requestRender?.();
		}
	}

	renderForTest(theme: Theme, width: number, frame = 0): string[] {
		this.frame = frame;
		return this.render(theme, width);
	}

	private render(theme: Theme, width: number): string[] {
		const live =
			this.model.ralph.some((snapshot) => isLiveState(snapshot.state)) ||
			this.model.reviews.some((snapshot) => isLiveState(snapshot.state));
		const heading = `${theme.fg(live ? "accent" : "dim", live ? "●" : "○")} ${theme.fg(live ? "accent" : "dim", "Harness")}`;
		const body: string[] = [];
		if (this.projectionError) body.push(theme.fg("error", `progress error: ${oneLine(this.projectionError, 72)}`));
		if (this.model.activeTask.pointer) body.push(...this.renderTask(theme));
		const ralph = [...this.model.ralph].sort(compareRalph);
		for (const snapshot of ralph) body.push(...this.renderRalph(theme, snapshot));
		const nested = new Set(ralph.map((snapshot) => snapshot.nestedReviewRunId).filter(Boolean));
		for (const snapshot of this.model.reviews) {
			if (nested.has(snapshot.runId)) continue;
			body.push(...this.renderReview(theme, snapshot, false));
		}
		return clampLines([heading, ...body], width, MAX_LINES);
	}

	private renderTask(theme: Theme): string[] {
		const pointer = this.model.activeTask.pointer!;
		const stale = this.model.activeTask.stale;
		const task = this.model.catalogTask;
		const title = task?.title ?? pointer.taskPath;
		const wi = task ? `WI ${task.workItems.complete}/${task.workItems.total}` : "WI —";
		const status = stale ? theme.fg("warning", `stale:${stale}`) : theme.fg("dim", task?.status ?? "selected");
		return [
			`${theme.fg("dim", "├─")} ${theme.fg("accent", "◆")} ${oneLine(title, 48)}  ${status} ${theme.fg("dim", `· ${wi}`)}`,
		];
	}

	private renderRalph(theme: Theme, snapshot: RalphProgressSnapshot): string[] {
		const live = isLiveState(snapshot.state);
		const glyph = live
			? theme.fg("accent", SPINNER[this.frame % SPINNER.length]!)
			: terminalGlyph(theme, snapshot.state);
		const wi = snapshot.workItems;
		const open = wi.items.find((item) => item.state === "open");
		const header = [
			`${theme.fg("dim", "├─")} ${glyph} ${theme.bold("Ralph")} ${theme.fg("muted", snapshot.state)}`,
			theme.fg("dim", `· iter ${snapshot.iteration}`),
			theme.fg("dim", `· ${formatTokens(snapshot.usage.totalTokens)}`),
			theme.fg(
				"dim",
				`· ${formatDuration(snapshot.startedAt, snapshot.terminalOutcome ? snapshot.updatedAt : undefined)}`,
			),
		].join(" ");
		const lines = [header];
		lines.push(
			`${theme.fg("dim", "│  ")} ${theme.fg("dim", `⎿  WI ${wi.complete}/${wi.total} complete${open ? ` · ${open.id} ${oneLine(open.description, 42)}` : wi.open ? ` · ${wi.open} open` : ""}`)}`,
		);
		if (snapshot.activity) {
			lines.push(`${theme.fg("dim", "│  ")} ${theme.fg("dim", `⎿  ${snapshot.activity.label}`)}`);
		}
		if (snapshot.nextObjective) {
			lines.push(`${theme.fg("dim", "│  ")} ${theme.fg("dim", `⎿  next: ${oneLine(snapshot.nextObjective, 64)}`)}`);
		}
		if (snapshot.gate) {
			lines.push(
				`${theme.fg("dim", "│  ")} ${theme.fg("warning", `⎿  gate: ${snapshot.gate.kind} — ${oneLine(snapshot.gate.reason, 56)}`)}`,
			);
		}
		if (snapshot.review) lines.push(...this.renderReview(theme, snapshot.review, true));
		return lines;
	}

	private renderReview(theme: Theme, snapshot: ReviewProgressSnapshot, nested: boolean): string[] {
		const live = isLiveState(snapshot.state);
		const glyph = live
			? theme.fg("accent", SPINNER[this.frame % SPINNER.length]!)
			: terminalGlyph(theme, snapshot.state);
		const prefix = nested ? `${theme.fg("dim", "│  ")} ` : `${theme.fg("dim", "├─")} `;
		const running = snapshot.focuses.filter((focus) => focus.state === "running");
		const queued = snapshot.focuses.filter((focus) => focus.state === "queued");
		const header = [
			`${prefix}${glyph} ${theme.bold("Review")} ${theme.fg("muted", snapshot.state)}`,
			theme.fg("dim", `· ${snapshot.source.mode}/${snapshot.profile}`),
			theme.fg("dim", `· c${snapshot.cycleIndex}/${snapshot.cycleCap}`),
			theme.fg("dim", `· ${snapshot.coverage.completed}/${snapshot.coverage.selected}`),
			theme.fg("dim", `· ${formatTokens(snapshot.usage.totalTokens)}`),
		].join(" ");
		const lines = [header];
		const focusTitles = [...running, ...queued].slice(0, 3).map((focus) => focus.title);
		if (snapshot.focuses.length > 0) {
			lines.push(
				`${nested ? theme.fg("dim", "│   ") : theme.fg("dim", "│  ")} ${theme.fg("dim", `⎿  ${running.length} running · ${queued.length} queued${focusTitles.length ? ` · ${focusTitles.join(", ")}` : ""}`)}`,
			);
		}
		if (snapshot.findings.length > 0) {
			lines.push(
				`${nested ? theme.fg("dim", "│   ") : theme.fg("dim", "│  ")} ${theme.fg("dim", `⎿  ${snapshot.findings.length} findings`)}`,
			);
		}
		return lines;
	}

	private clear(): void {
		const ui = this.ui;
		const wasRegistered = this.registered;
		const hadStatus = this.lastStatus !== undefined;
		this.registered = false;
		this.tui = undefined;
		this.lastStatus = undefined;
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
		// Pi's setWidget(undefined) disposes the current component first. Drop local
		// registration before that call so a factory dispose cannot re-enter setWidget.
		if (wasRegistered && ui) ui.setWidget(WIDGET_ID, undefined);
		if (hadStatus && ui) ui.setStatus(STATUS_KEY, undefined);
	}

	dispose(): void {
		this.clear();
		this.ui = undefined;
	}
}

function liveStatus(ralph: RalphProgressSnapshot[], reviews: ReviewProgressSnapshot[]): string | undefined {
	const parts: string[] = [];
	if (ralph.length) {
		const first = ralph[0]!;
		parts.push(`Ralph ${first.state} iter ${first.iteration} WI ${first.workItems.complete}/${first.workItems.total}`);
	}
	if (reviews.length) {
		const first = reviews[0]!;
		parts.push(`Review ${first.state} c${first.cycleIndex}/${first.cycleCap}`);
	}
	return parts.length ? parts.join(" · ") : undefined;
}

function compareRalph(left: RalphProgressSnapshot, right: RalphProgressSnapshot): number {
	const live = Number(isLiveState(right.state)) - Number(isLiveState(left.state));
	if (live !== 0) return live;
	return right.updatedAt.localeCompare(left.updatedAt);
}

export function renderCompactLines(model: CompactWidgetModel, theme: Theme, width: number, frame = 0): string[] {
	const widget = new CompactOperationsWidget();
	widget.setActiveTask(model.activeTask, model.catalogTask);
	for (const snapshot of model.ralph) widget.applyRalph(snapshot);
	for (const snapshot of model.reviews) widget.applyReview(snapshot);
	return widget.renderForTest(theme, width, frame);
}
