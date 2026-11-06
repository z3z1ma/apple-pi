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
	const seen = new Set<string>();
	for (const file of sessionFiles(options.sessionsDir)) {
		if (statSync(file).mtimeMs < options.since) continue;
		const input = createReadStream(file, "utf8");
		const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
		let session: LoggedSession | undefined;
		try {
			for await (const line of lines) {
				if (!session) {
					const header = parsed(line);
					if (header?.type !== "session" || typeof header.id !== "string" || typeof header.cwd !== "string") break;
					if (!within(root, canonical(header.cwd))) break;
					session = { id: header.id, cwd: header.cwd, file };
					continue;
				}
				if (!options.wanted(line)) continue;
				const entry = parsed(line);
				if (typeof entry?.timestamp !== "string" || Date.parse(entry.timestamp) < options.since) continue;
				const identity = `${entry.id}@${entry.timestamp}`;
				if (seen.has(identity)) continue;
				seen.add(identity);
				yield { session, entry };
			}
		} finally {
			lines.close();
			input.destroy();
		}
	}
}
