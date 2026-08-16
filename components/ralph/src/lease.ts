import { dirname, resolve } from "node:path";
import { realpathSync } from "node:fs";
import {
	acquireExclusiveLease,
	activeExclusiveLease,
	type ExclusiveLeaseOwner,
} from "../../shared/src/exclusive-lease.js";
import { taskLocation } from "./task-paths.js";

export type LeaseOwner = ExclusiveLeaseOwner;

export function activeProjectLease(projectRoot: string): LeaseOwner | undefined {
	return activeExclusiveLease("ralph", projectRoot);
}

export function assertProjectLease(projectRootInput: string, runId: string): void {
	const projectRoot = realpathSync(projectRootInput);
	const owner = activeProjectLease(projectRoot);
	if (!owner || owner.pid !== process.pid || owner.runId !== runId) {
		throw new Error(`Ralph run ${runId} does not own this resource: ${projectRoot}`);
	}
}

export function acquireProjectLease(projectRootInput: string, runId: string): () => void {
	const projectRoot = realpathSync(projectRootInput);
	return acquireExclusiveLease("ralph", projectRoot, runId, {
		unreadable: (path) => `Ralph resource lease is unreadable: ${path}`,
		owned: (owner, root) => `Ralph run ${owner.runId} in process ${owner.pid} already owns this resource: ${root}`,
		failed: "Could not acquire the Ralph resource lease",
	});
}

export function acquireRalphRunLeases(
	workspaceRoot: string,
	ledgerRoot: string,
	taskPath: string,
	runId: string,
): () => void {
	if (!taskLocation(taskPath)) throw new Error(`Invalid Ralph task path: ${taskPath}`);
	const taskBundle = realpathSync(resolve(ledgerRoot, dirname(taskPath)));
	const resources = [...new Set([realpathSync(workspaceRoot), taskBundle])].sort();
	const releases: Array<() => void> = [];
	try {
		for (const resource of resources) releases.push(acquireProjectLease(resource, runId));
	} catch (error) {
		for (const release of releases.reverse()) release();
		throw error;
	}
	return () => {
		for (const release of releases.reverse()) release();
	};
}
