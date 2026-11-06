import { createReadStream, type Dirent, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
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
	for (const file of sessionFiles(options.sessionsDir)) {
		if (statSync(file).mtimeMs < options.since) continue;
		const lines = createInterface({ input: createReadStream(file, "utf8"), crlfDelay: Number.POSITIVE_INFINITY });
		let session: LoggedSession | undefined;
		try {
			for await (const line of lines) {
				if (!session) {
					const header = parsed(line);
					if (header?.type !== "session" || typeof header.id !== "string" || typeof header.cwd !== "string") break;
					if (!within(options.root, header.cwd)) break;
					session = { id: header.id, cwd: header.cwd, file };
					continue;
				}
				if (!options.wanted(line)) continue;
				const entry = parsed(line);
				if (typeof entry?.timestamp !== "string" || Date.parse(entry.timestamp) < options.since) continue;
				yield { session, entry };
			}
		} finally {
			lines.close();
		}
	}
}
