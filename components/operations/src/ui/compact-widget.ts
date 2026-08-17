import type { CatalogTask } from "../../../ledger/src/catalog.js";
import type { ActiveTaskProjection } from "../session-state.js";
import { clampLines } from "./bounded-lines.js";
import { oneLine, type Theme } from "./format.js";

const WIDGET_ID = "harness";
const STATUS_KEY = "harness";
const MAX_LINES = 14;

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
}

export class CompactOperationsWidget {
	private ui: WidgetUICtx | undefined;
	private tui: { terminal?: { columns?: number }; requestRender?: () => void } | undefined;
	private registered = false;
	private lastStatus: string | undefined;
	private model: CompactWidgetModel = { activeTask: {} };

	setUICtx(ctx: WidgetUICtx | undefined): void {
		if (ctx === this.ui) return;
		this.ui = ctx;
		this.registered = false;
		this.tui = undefined;
		this.lastStatus = undefined;
		if (ctx) this.update();
	}

	setActiveTask(activeTask: ActiveTaskProjection, catalogTask?: CatalogTask): void {
		this.model = { activeTask, catalogTask };
		this.update();
	}

	update(): void {
		if (!this.ui) return;
		const hasTask = Boolean(this.model.activeTask.pointer);
		if (!hasTask) {
			this.clear();
			return;
		}
		const status = this.model.catalogTask
			? `${this.model.catalogTask.status} ${this.model.catalogTask.title}`
			: this.model.activeTask.pointer?.taskPath;
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

	renderForTest(theme: Theme, width: number): string[] {
		return this.render(theme, width);
	}

	private render(theme: Theme, width: number): string[] {
		const heading = `${theme.fg("dim", "○")} ${theme.fg("dim", "Harness")}`;
		const body = this.model.activeTask.pointer ? this.renderTask(theme) : [];
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

	private clear(): void {
		const ui = this.ui;
		const wasRegistered = this.registered;
		const hadStatus = this.lastStatus !== undefined;
		this.registered = false;
		this.tui = undefined;
		this.lastStatus = undefined;
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

export function renderCompactLines(model: CompactWidgetModel, theme: Theme, width: number): string[] {
	const widget = new CompactOperationsWidget();
	widget.setActiveTask(model.activeTask, model.catalogTask);
	return widget.renderForTest(theme, width);
}
