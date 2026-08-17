import type { EventBus, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RalphController, StartRunOptions } from "./controller.js";
import { activeProjectLease } from "./lease.js";
import { listRalphReceiptRows, type RalphReceiptRow } from "./receipts.js";
import { resolveRalphRoots } from "./roots.js";
import type { RalphProgressSnapshot } from "./types.js";

const CHANNEL = "apple-pi:ralph-operations-service:request";
let installedService: RalphOperationsService | undefined;

export type RalphRunOwnership =
	| { kind: "owned" }
	| { kind: "foreign"; pid: number; ownerRunId: string }
	| { kind: "stale" };

export interface RalphOperationsService {
	subscribeProgress(listener: (snapshot: RalphProgressSnapshot) => void): () => void;
	liveSnapshots(): RalphProgressSnapshot[];
	listReceipts(projectRoot: string): RalphReceiptRow[];
	classifyOwnership(projectRoot: string, runId: string): RalphRunOwnership;
	stop(projectRoot: string, runId: string): Promise<unknown>;
	stopAll(): Promise<void>;
	start(ctx: ExtensionContext, taskPath: string, options?: StartRunOptions): Promise<unknown>;
	continue(
		ctx: ExtensionContext,
		runId: string,
		maxIterations: number,
		signal?: AbortSignal,
		root?: string,
	): Promise<unknown>;
}

export function installRalphOperationsService(service: RalphOperationsService, events?: EventBus): () => void {
	installedService = service;
	const unsubscribe = events?.on(CHANNEL, (reply) => {
		if (typeof reply === "function") (reply as (value: RalphOperationsService) => void)(service);
	});
	return () => {
		unsubscribe?.();
		if (installedService === service) installedService = undefined;
	};
}

export function getRalphOperationsService(events?: EventBus): RalphOperationsService | undefined {
	let discovered: RalphOperationsService | undefined;
	events?.emit(CHANNEL, (service: RalphOperationsService) => {
		discovered ??= service;
	});
	return discovered ?? installedService;
}

export function ralphOperationsService(controller: RalphController): RalphOperationsService {
	return {
		subscribeProgress: (listener) => controller.subscribeProgress(listener),
		liveSnapshots: () => controller.liveProgress(),
		listReceipts: (projectRoot) => listRalphReceiptRows(resolveRalphRoots(projectRoot).workspaceRoot),
		classifyOwnership: (projectRoot, runId) => controller.classifyOwnership(projectRoot, runId),
		stop: (projectRoot, runId) => controller.stop(projectRoot, runId),
		stopAll: () => controller.stopAll(),
		start: (ctx, taskPath, options) => controller.start(ctx, taskPath, options),
		continue: (ctx, runId, maxIterations, signal, root) => controller.continue(ctx, runId, maxIterations, signal, root),
	};
}

export function classifyRalphLease(projectRoot: string, runId: string, owned: boolean): RalphRunOwnership {
	if (owned) return { kind: "owned" };
	const owner = activeProjectLease(projectRoot);
	if (owner && owner.runId === runId && owner.pid !== process.pid) {
		return { kind: "foreign", pid: owner.pid, ownerRunId: owner.runId };
	}
	return { kind: "stale" };
}
