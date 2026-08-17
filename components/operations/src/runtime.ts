import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type CatalogTask, inspectLedgerTask, listLedgerTasks } from "../../ralph/src/catalog.js";
import type { RalphOperationsService } from "../../ralph/src/operations-service.js";
import { resolveRalphRoots } from "../../ralph/src/roots.js";
import {
	type ActiveTaskProjection,
	knownProjectRoots,
	OPERATION_POINTER_ENTRY,
	OPERATION_POINTER_TOMBSTONE,
	type OperationKind,
	type OperationsSessionProjection,
	projectOperationsSession,
	type SessionEntryLike,
} from "./session-state.js";
import { CompactOperationsWidget, type WidgetUICtx } from "./ui/compact-widget.js";
import { createHubModel, type HubView, handleHubInput, renderHub } from "./ui/hub.js";
import type { RalphViewRow } from "./ui/ralph-view.js";

const RUNTIME_CHANNEL = "apple-pi:operations-runtime:request";
let installedRuntime: OperationsRuntime | undefined;

export function isTuiContext(ctx: { mode?: string; hasUI?: boolean }): boolean {
	return ctx.mode === "tui" && ctx.hasUI === true;
}

export class OperationsRuntime {
	readonly widget = new CompactOperationsWidget();
	projection: OperationsSessionProjection = { activeTask: {}, operationRoots: [] };
	catalogTask?: CatalogTask;

	constructor(
		private readonly pi: ExtensionAPI,
		readonly ralph: RalphOperationsService,
	) {
		ralph.subscribeProgress((snapshot) => this.widget.applyRalph(snapshot));
	}

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

	recordOperationPointer(ctx: ExtensionContext, kind: OperationKind, projectRoot: string, runId?: string): void {
		this.pi.appendEntry(OPERATION_POINTER_ENTRY, {
			schemaVersion: 1,
			kind,
			projectRoot,
			...(runId && { runId }),
		});
		this.reconstruct(ctx);
	}

	clearOperationRoot(kind: OperationKind, projectRoot: string): void {
		this.pi.appendEntry(OPERATION_POINTER_TOMBSTONE, { schemaVersion: 1, kind, projectRoot, removed: true });
	}

	knownRoots(sessionRoot: string): string[] {
		return knownProjectRoots(sessionRoot, this.projection);
	}

	async openHub(ctx: ExtensionCommandContext, view: HubView = "ledger"): Promise<void> {
		if (!isTuiContext(ctx)) {
			ctx.ui.notify(this.nonTuiSummary(ctx.cwd, view), "info");
			return;
		}
		this.reconstruct(ctx);
		let model = createHubModel(this.projection.activeTask, this.loadTasks(ctx.cwd));
		model = { ...model, view, ralph: this.ralphRows(ctx.cwd) };
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
				const ledgerRoot = resolveRalphRoots(ctx.cwd).ledgerRoot;
				this.pi.appendEntry("apple-pi.ledger.active-task", { schemaVersion: 1, ledgerRoot, taskPath });
				this.reconstruct(ctx);
			},
			clearTask: () => {
				this.pi.appendEntry("apple-pi.ledger.active-task.tombstone", { schemaVersion: 1, cleared: true });
				this.reconstruct(ctx);
			},
			startRalph: (taskPath: string) => {
				void this.launchRalph(ctx, taskPath, false);
			},
			runRalph: (taskPath: string) => {
				void this.launchRalph(ctx, taskPath, true);
			},
			stopRalph: async (projectRoot: string, runId: string) => {
				const ownership = this.ralph.classifyOwnership(projectRoot, runId);
				if (ownership.kind !== "owned") return;
				await this.ralph.stop(projectRoot, runId);
			},
		};
	}

	private async launchRalph(ctx: ExtensionCommandContext, taskPath: string, autonomous: boolean): Promise<void> {
		try {
			const run = (await this.ralph.start(ctx, taskPath, { mode: autonomous ? "auto" : "step" })) as {
				projectRoot: string;
				runId: string;
			};
			this.recordOperationPointer(ctx, "ralph", run.projectRoot, run.runId);
			ctx.ui.notify(autonomous ? `Ralph run ${taskPath} started.` : `Ralph started ${taskPath}`, "info");
			if (autonomous) void this.ralph.continue(ctx, run.runId, Number.POSITIVE_INFINITY, undefined, run.projectRoot);
		} catch (error) {
			ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
		}
	}

	private loadTasks(cwd: string): CatalogTask[] {
		try {
			return listLedgerTasks(resolveRalphRoots(cwd).ledgerRoot);
		} catch {
			return [];
		}
	}

	ralphRows(cwd: string): RalphViewRow[] {
		const live = new Map(this.ralph.liveSnapshots().map((snapshot) => [snapshot.runId, snapshot]));
		const rows: RalphViewRow[] = [];
		for (const root of this.knownRoots(cwd)) {
			for (const receipt of this.ralph.listReceipts(root)) {
				const runId = receipt.kind === "summary" ? receipt.summary.runId : receipt.runId;
				rows.push({
					runId,
					workspaceRoot: root,
					live: live.get(runId),
					receipt,
					ownership: this.ralph.classifyOwnership(root, runId),
				});
			}
		}
		for (const snapshot of live.values()) {
			if (!rows.some((row) => row.runId === snapshot.runId)) {
				rows.unshift({
					runId: snapshot.runId,
					workspaceRoot: snapshot.projectRoot,
					live: snapshot,
					ownership: this.ralph.classifyOwnership(snapshot.projectRoot, snapshot.runId),
				});
			}
		}
		return rows;
	}

	private nonTuiSummary(cwd: string, view: HubView): string {
		if (view === "ledger") {
			const pointer = this.projection.activeTask.pointer;
			return pointer
				? `Active task ${pointer.taskPath}${this.projection.activeTask.stale ? ` (${this.projection.activeTask.stale})` : ""}`
				: "No active ledger task.";
		}
		if (view === "ralph") {
			return (
				this.ralphRows(cwd)
					.slice(0, 10)
					.map((row) => `${row.runId} ${row.live?.state ?? row.receipt?.kind}`)
					.join("\n") || "No Ralph runs."
			);
		}
		return "No Ralph runs.";
	}

	async dispose(): Promise<void> {
		await this.ralph.stopAll();
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
