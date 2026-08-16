import { createHash } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { taskLocation } from "./task-paths.js";

interface LeaseOwner {
	pid: number;
	runId: string;
	projectRoot: string;
	acquiredAt: string;
}

function leasePath(projectRoot: string): string {
	const key = createHash("sha256").update(realpathSync(projectRoot)).digest("hex").slice(0, 24);
	return join(getAgentDir(), "ralph", "locks", `${key}.lock`);
}

function live(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

function readOwner(path: string): LeaseOwner | undefined {
	try {
		const value = JSON.parse(readFileSync(path, "utf8")) as LeaseOwner;
		return Number.isInteger(value.pid) && typeof value.runId === "string" ? value : undefined;
	} catch {
		return undefined;
	}
}

export function activeProjectLease(projectRoot: string): LeaseOwner | undefined {
	const owner = readOwner(leasePath(projectRoot));
	return owner && live(owner.pid) ? owner : undefined;
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
	const path = leasePath(projectRoot);
	mkdirSync(join(getAgentDir(), "ralph", "locks"), { recursive: true, mode: 0o700 });
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const descriptor = openSync(path, "wx", 0o600);
			const owner: LeaseOwner = { pid: process.pid, runId, projectRoot, acquiredAt: new Date().toISOString() };
			try {
				writeFileSync(descriptor, JSON.stringify(owner), "utf8");
			} finally {
				closeSync(descriptor);
			}
			let released = false;
			return () => {
				if (released) return;
				released = true;
				const current = readOwner(path);
				if (current?.pid === process.pid && current.runId === runId) {
					try {
						unlinkSync(path);
					} catch (error) {
						if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
					}
				}
			};
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			const owner = readOwner(path);
			if (!owner) throw new Error(`Ralph resource lease is unreadable: ${path}`);
			if (live(owner.pid))
				throw new Error(`Ralph run ${owner.runId} in process ${owner.pid} already owns this resource: ${projectRoot}`);
			try {
				unlinkSync(path);
			} catch (unlinkError) {
				if ((unlinkError as NodeJS.ErrnoException).code !== "ENOENT") throw unlinkError;
			}
		}
	}
	throw new Error("Could not acquire the Ralph resource lease");
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
