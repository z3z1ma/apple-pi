import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface ReviewLeaseOwner {
	pid: number;
	runId: string;
	projectRoot: string;
	acquiredAt: string;
}

function leasePath(projectRootInput: string): string {
	const projectRoot = realpathSync(projectRootInput);
	const key = createHash("sha256").update(projectRoot).digest("hex").slice(0, 24);
	return join(getAgentDir(), "reviews", "locks", key);
}

function processLive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

function readOwner(path: string): ReviewLeaseOwner | undefined {
	try {
		const value = JSON.parse(readFileSync(join(path, "owner.json"), "utf8")) as ReviewLeaseOwner;
		return Number.isInteger(value.pid) && typeof value.runId === "string" && typeof value.projectRoot === "string"
			? value
			: undefined;
	} catch {
		return undefined;
	}
}

export function activeReviewLease(projectRoot: string): ReviewLeaseOwner | undefined {
	const owner = readOwner(leasePath(projectRoot));
	return owner && processLive(owner.pid) ? owner : undefined;
}

export function acquireReviewLease(projectRootInput: string, runId: string): () => void {
	const projectRoot = realpathSync(projectRootInput);
	const path = leasePath(projectRoot);
	mkdirSync(join(getAgentDir(), "reviews", "locks"), { recursive: true, mode: 0o700 });
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			mkdirSync(path, { mode: 0o700 });
			const owner: ReviewLeaseOwner = { pid: process.pid, runId, projectRoot, acquiredAt: new Date().toISOString() };
			writeFileSync(join(path, "owner.json"), JSON.stringify(owner), { encoding: "utf8", mode: 0o600 });
			let released = false;
			return () => {
				if (released) return;
				released = true;
				const current = readOwner(path);
				if (current?.pid === process.pid && current.runId === runId) rmSync(path, { recursive: true, force: true });
			};
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			const owner = readOwner(path);
			if (owner && processLive(owner.pid)) throw new Error(`Review run ${owner.runId} in process ${owner.pid} already owns this project`);
			rmSync(path, { recursive: true, force: true });
		}
	}
	throw new Error("Could not acquire the review project lease");
}
