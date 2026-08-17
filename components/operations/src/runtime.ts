import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type CatalogTask, inspectLedgerTask, listLedgerTasks } from "../../ledger/src/catalog.js";
import { resolveLedgerRoots } from "../../ledger/src/roots.js";
import {
	type ActiveTaskProjection,
	type OperationsSessionProjection,
	projectOperationsSession,
	type SessionEntryLike,
} from "./session-state.js";
import { CompactOperationsWidget, type WidgetUICtx } from "./ui/compact-widget.js";
import { createHubModel, handleHubInput, renderHub } from "./ui/hub.js";

const RUNTIME_CHANNEL = "apple-pi:operations-runtime:request";
let installedRuntime: OperationsRuntime | undefined;

export function isTuiContext(ctx: { mode?: string; hasUI?: boolean }): boolean {
	return ctx.mode === "tui" && ctx.hasUI === true;
}

export class OperationsRuntime {
	readonly widget = new CompactOperationsWidget();
	projection: OperationsSessionProjection = { activeTask: {}, operationRoots: [] };
	catalogTask?: CatalogTask;

	constructor(private readonly pi: ExtensionAPI) {}

	reconstruct(ctx: ExtensionContext): void {
		const entries = ((ctx.sessionManager as { getBranch?: () => SessionEntryLike[] }).getBranch?.() ??
			[]) as SessionEntryLike[];
		this.projection = projectOperationsSession(entries, ctx.cwd);
		this.catalogTask = undefined;
		const pointer = this.projection.activeTask.pointer;
		if (pointer && !this.projection.activeTask.stale) {
			try {
				this.catalogTask = inspectLedgerTask(pointer.ledgerRoot, pointer.taskPath);
			} catch {
				this.projection.activeTask.stale = "malformed";
			}
		}
		this.widget.setActiveTask(this.projection.activeTask, this.catalogTask);
		if (isTuiContext(ctx)) this.widget.setUICtx(ctx.ui as WidgetUICtx);
	}

	async openHub(ctx: ExtensionCommandContext): Promise<void> {
		if (!isTuiContext(ctx)) {
			ctx.ui.notify(this.nonTuiSummary(), "info");
			return;
		}
		this.reconstruct(ctx);
		let model = createHubModel(this.projection.activeTask, this.loadTasks(ctx.cwd));
		await ctx.ui.custom((tui, theme, keybindings, done) => {
			const component = {
				render: (width: number) =>
					renderHub(model, theme, width, Math.min(22, Math.max(12, (tui.terminal?.rows ?? 24) - 8))),
				invalidate: () => {},
				handleInput: (data: string) => {
					const result = handleHubInput(model, data, this.hubActions(ctx), keybindings);
					model = result.model;
					tui.requestRender();
					if (result.close) done(undefined);
				},
			};
			return component;
		});
	}

	private hubActions(ctx: ExtensionCommandContext) {
		return {
			selectTask: (taskPath: string) => {
				const ledgerRoot = resolveLedgerRoots(ctx.cwd).ledgerRoot;
				this.pi.appendEntry("apple-pi.ledger.active-task", { schemaVersion: 1, ledgerRoot, taskPath });
				this.reconstruct(ctx);
			},
			clearTask: () => {
				this.pi.appendEntry("apple-pi.ledger.active-task.tombstone", { schemaVersion: 1, cleared: true });
				this.reconstruct(ctx);
			},
		};
	}

	private loadTasks(cwd: string): CatalogTask[] {
		try {
			return listLedgerTasks(resolveLedgerRoots(cwd).ledgerRoot);
		} catch {
			return [];
		}
	}

	private nonTuiSummary(): string {
		const pointer = this.projection.activeTask.pointer;
		return pointer
			? `Active task ${pointer.taskPath}${this.projection.activeTask.stale ? ` (${this.projection.activeTask.stale})` : ""}`
			: "No active ledger task.";
	}

	async dispose(): Promise<void> {
		this.widget.dispose();
	}
}

export function installOperationsRuntime(runtime: OperationsRuntime, events?: ExtensionAPI["events"]): () => void {
	installedRuntime = runtime;
	const unsubscribe = events?.on(RUNTIME_CHANNEL, (reply) => {
		if (typeof reply === "function") (reply as (value: OperationsRuntime) => void)(runtime);
	});
	return () => {
		unsubscribe?.();
		if (installedRuntime === runtime) installedRuntime = undefined;
	};
}

export function getOperationsRuntime(events?: ExtensionAPI["events"]): OperationsRuntime | undefined {
	let discovered: OperationsRuntime | undefined;
	events?.emit(RUNTIME_CHANNEL, (runtime: OperationsRuntime) => {
		discovered ??= runtime;
	});
	return discovered ?? installedRuntime;
}

export function activeTaskProjection(runtime: OperationsRuntime | undefined): ActiveTaskProjection {
	return runtime?.projection.activeTask ?? {};
}
