/**
 * On-disk state contract between the Pi extension and the tmux bash scripts.
 *
 * Each root Pi session running inside tmux publishes one JSON record describing
 * its live status, tmux pane, and pid. `scripts/agents.sh` reads these records
 * instead of a `claude agents --json` equivalent, which Pi does not have.
 *
 * The record is the integration boundary. Writes are atomic (temp file +
 * rename) so the picker never parses a half-written file, and the pid + pane id
 * let the bash side reject a phantom record left behind by a crashed or
 * SIGKILL'd Pi.
 */
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const HOME = homedir();
const PI_HOME = process.env.PI_CODING_AGENT_DIR || join(HOME, ".pi", "agent");

/** Directory holding one `<sessionId>.json` record per live tmux Pi session. */
export const STATE_DIR = process.env.PI_TMUX_STATE_DIR || join(PI_HOME, "state", "tmux-sessions");

/** Bump when the record shape changes in a way the scripts must notice. */
export const STATE_SCHEMA = 1;

/**
 * Agent status, mirroring the three states the picker sorts on:
 * - `waiting`: the agent asked the user something and is blocked on an answer.
 * - `idle`: the turn settled; it is the user's turn.
 * - `busy`: the agent loop is running.
 */
export type AgentStatus = "busy" | "idle" | "waiting";

export interface AgentStateRecord {
	schema: number;
	sessionId: string;
	/** OS pid of the Pi process, used by the scripts for a liveness check. */
	pid: number;
	status: AgentStatus;
	cwd: string;
	/** Display name (Pi session name) or empty when unset. */
	sessionName: string;
	/** tmux pane id (e.g. `%3`) the Pi TUI occupies. */
	paneId: string;
	/** tmux window id (e.g. `@2`) the pane lives in. */
	windowId: string;
	/** tmux pane pty path, used to ring the pane bell on settle. */
	paneTty: string;
	/** Epoch seconds when the record was first written. */
	startedAt: number;
	/** Epoch seconds of the last status change; drives the picker age column. */
	updatedAt: number;
}

/** Filesystem-safe basename for a session id. */
export function safeSessionId(value: string): string {
	return value.replace(/[^A-Za-z0-9_.-]/gu, "_").slice(0, 96) || "unknown";
}

function recordPath(sessionId: string): string {
	return join(STATE_DIR, `${safeSessionId(sessionId)}.json`);
}

/**
 * Atomically write a record: serialize to a hidden temp file in the same
 * directory, then rename over the target. rename(2) within a directory is
 * atomic, so a concurrent reader sees either the old file or the new one, never
 * a partial write.
 */
export async function writeState(record: AgentStateRecord): Promise<void> {
	await mkdir(STATE_DIR, { recursive: true });
	const target = recordPath(record.sessionId);
	const temp = join(STATE_DIR, `.${safeSessionId(record.sessionId)}.${process.pid}.tmp`);
	await writeFile(temp, `${JSON.stringify(record)}\n`, "utf8");
	await rename(temp, target);
}

/** Remove a session's record on clean shutdown. Missing file is not an error. */
export async function removeState(sessionId: string): Promise<void> {
	await rm(recordPath(sessionId), { force: true });
}

/** Read and parse every published record, skipping unreadable/corrupt files. */
export async function readAllStates(): Promise<AgentStateRecord[]> {
	let names: string[];
	try {
		names = await readdir(STATE_DIR);
	} catch {
		return [];
	}
	const records: AgentStateRecord[] = [];
	for (const name of names) {
		if (!name.endsWith(".json")) continue;
		try {
			const parsed = JSON.parse(await readFile(join(STATE_DIR, name), "utf8"));
			if (parsed && typeof parsed === "object") records.push(parsed as AgentStateRecord);
		} catch {
			// Ignore a record we cannot read or parse.
		}
	}
	return records;
}
