import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface ExclusiveLeaseOwner {
	pid: number;
	runId: string;
	projectRoot: string;
	acquiredAt: string;
}

export interface ExclusiveLeaseMessages {
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

function leaseBase(kind: string, projectRoot: string): string {
	const key = createHash("sha256").update(projectRoot).digest("hex").slice(0, 24);
	return join(getAgentDir(), kind, "locks", key);
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

function sameOwner(left: ExclusiveLeaseOwner | undefined, right: ExclusiveLeaseOwner): boolean {
	return (
		left?.pid === right.pid &&
		left.runId === right.runId &&
		left.projectRoot === right.projectRoot &&
		left.acquiredAt === right.acquiredAt
	);
}

function publishOwner(path: string, owner: ExclusiveLeaseOwner): void {
	const candidate = `${path}.${process.pid}.${randomUUID()}.tmp`;
	try {
		writeFileSync(candidate, JSON.stringify(owner), { encoding: "utf8", mode: 0o600 });
		renameSync(candidate, path);
	} finally {
		try {
			unlinkSync(candidate);
		} catch {
			// The published owner file is authoritative; a temp cleanup failure is harmless.
		}
	}
}

function removeOwner(path: string, owner: ExclusiveLeaseOwner): void {
	if (!sameOwner(readOwner(path), owner)) return;
	try {
		unlinkSync(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
}

export function activeExclusiveLease(kind: string, projectRootInput: string): ExclusiveLeaseOwner | undefined {
	const owner = readOwner(`${leaseBase(kind, realpathSync(projectRootInput))}.owner`);
	return owner && processLive(owner.pid) ? owner : undefined;
}

/**
 * Hold a SQLite write transaction for the lease lifetime. The operating system
 * releases SQLite's file lock when a process exits, so crash recovery never
 * removes a pathname that a replacement owner may already hold.
 */
export function acquireExclusiveLease(
	kind: string,
	projectRootInput: string,
	runId: string,
	messages: ExclusiveLeaseMessages,
): () => void {
	const projectRoot = realpathSync(projectRootInput);
	const base = leaseBase(kind, projectRoot);
	const databasePath = `${base}.sqlite`;
	const ownerPath = `${base}.owner`;
	mkdirSync(join(getAgentDir(), kind, "locks"), { recursive: true, mode: 0o700 });
	const owner: ExclusiveLeaseOwner = {
		pid: process.pid,
		runId,
		projectRoot,
		acquiredAt: new Date().toISOString(),
	};
	const database = new DatabaseSync(databasePath);
	try {
		database.exec("PRAGMA busy_timeout = 0; CREATE TABLE IF NOT EXISTS lease (id INTEGER PRIMARY KEY);");
		database.exec("BEGIN IMMEDIATE;");
	} catch (error) {
		database.close();
		const existing = readOwner(ownerPath);
		if ((error as { errcode?: number }).errcode === 5) {
			if (existing && processLive(existing.pid)) throw new Error(messages.owned(existing, projectRoot));
			throw new Error(messages.failed);
		}
		throw error;
	}
	try {
		publishOwner(ownerPath, owner);
	} catch (error) {
		database.exec("ROLLBACK;");
		database.close();
		throw error;
	}
	let released = false;
	return () => {
		if (released) return;
		released = true;
		try {
			database.exec("ROLLBACK;");
		} finally {
			database.close();
			removeOwner(ownerPath, owner);
		}
	};
}
