import { createReadStream, type Dirent, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createInterface } from "node:readline";

export interface LoggedSession {
	id: string;
	cwd: string;
	file: string;
}

export interface LoggedEntry {
	session: LoggedSession;
	entry: Record<string, unknown> & { id?: string; timestamp?: string };
}

function sessionFiles(dir: string): string[] {
	let entries: Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	return entries.flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return sessionFiles(path);
		return entry.name.endsWith(".jsonl") ? [path] : [];
	});
}

export function canonical(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		const parent = dirname(path);
		return parent === path ? path : join(canonical(parent), basename(path));
	}
}

export function within(root: string, path: string): boolean {
	return path === root || path.startsWith(`${root}/`);
}

function parsed(line: string): (Record<string, unknown> & { id?: string; timestamp?: string }) | undefined {
	try {
		return JSON.parse(line);
	} catch {
		return undefined;
	}
}

export async function* sessionEntries(options: {
	sessionsDir: string;
	root: string;
	since: number;
	wanted: (line: string) => boolean;
}): AsyncGenerator<LoggedEntry> {
	const root = canonical(options.root);
	for (const file of sessionFiles(options.sessionsDir)) {
		if (statSync(file).mtimeMs < options.since) continue;
		const input = createReadStream(file, "utf8");
		const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
		let session: LoggedSession | undefined;
		let created = 0;
		try {
			for await (const line of lines) {
				if (!session) {
					const header = parsed(line);
					if (header?.type !== "session" || typeof header.id !== "string" || typeof header.cwd !== "string") break;
					if (!within(root, canonical(header.cwd))) break;
					session = { id: header.id, cwd: header.cwd, file };
					created = typeof header.timestamp === "string" ? Date.parse(header.timestamp) : Number.NaN;
					continue;
				}
				if (!options.wanted(line)) continue;
				const entry = parsed(line);
				const at = typeof entry?.timestamp === "string" ? Date.parse(entry.timestamp) : Number.NaN;
				if (!Number.isFinite(at) || at < options.since || at < created) continue;
				yield { session, entry: entry! };
			}
		} finally {
			lines.close();
			input.destroy();
		}
	}
}
