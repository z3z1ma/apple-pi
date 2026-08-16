import { createHash } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface ExclusiveLeaseOwner {
	pid: number;
	runId: string;
	projectRoot: string;
	acquiredAt: string;
}

export interface ExclusiveLeaseMessages {
	unreadable: (path: string) => string;
	owned: (owner: ExclusiveLeaseOwner, projectRoot: string) => string;
	failed: string;
}

function processLive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

function leasePath(kind: string, projectRoot: string): string {
	const key = createHash("sha256").update(projectRoot).digest("hex").slice(0, 24);
	return join(getAgentDir(), kind, "locks", `${key}.lock`);
}

function readOwner(path: string): ExclusiveLeaseOwner | undefined {
	try {
		const value = JSON.parse(readFileSync(path, "utf8")) as ExclusiveLeaseOwner;
		return Number.isInteger(value.pid) && typeof value.runId === "string" && typeof value.projectRoot === "string"
			? value
			: undefined;
	} catch {
		return undefined;
	}
}

function removeLease(path: string): void {
	try {
		unlinkSync(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
}

export function activeExclusiveLease(kind: string, projectRootInput: string): ExclusiveLeaseOwner | undefined {
	const owner = readOwner(leasePath(kind, realpathSync(projectRootInput)));
	return owner && processLive(owner.pid) ? owner : undefined;
}

export function acquireExclusiveLease(
	kind: string,
	projectRootInput: string,
	runId: string,
	messages: ExclusiveLeaseMessages,
): () => void {
	const projectRoot = realpathSync(projectRootInput);
	const path = leasePath(kind, projectRoot);
	mkdirSync(join(getAgentDir(), kind, "locks"), { recursive: true, mode: 0o700 });
	const owner: ExclusiveLeaseOwner = {
		pid: process.pid,
		runId,
		projectRoot,
		acquiredAt: new Date().toISOString(),
	};
	for (let attempt = 0; attempt < 2; attempt++) {
		const current = readOwner(path);
		if (current && processLive(current.pid)) throw new Error(messages.owned(current, projectRoot));
		if (current) removeLease(path);

		try {
			const descriptor = openSync(path, "wx", 0o600);
			try {
				writeFileSync(descriptor, JSON.stringify(owner), "utf8");
			} finally {
				closeSync(descriptor);
			}
			let released = false;
			return () => {
				if (released) return;
				released = true;
				const held = readOwner(path);
				if (held?.pid === process.pid && held.runId === runId) removeLease(path);
			};
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			const existing = readOwner(path);
			if (existing && processLive(existing.pid)) throw new Error(messages.owned(existing, projectRoot));
			if (!existing) throw new Error(messages.unreadable(path));
			removeLease(path);
		}
	}
	throw new Error(messages.failed);
}
