import {
	chmodSync,
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { CredentialStatus } from "../../integrations.js";

export interface AtlassianCredentials {
	site: string;
	email: string;
	token: string;
}

export interface SlackCredentials {
	token: string;
	cookie: string;
	team: string | null;
	url: string | null;
	user: string | null;
	sendAsMe?: boolean;
}

export interface StoredCredentials {
	atlassian?: AtlassianCredentials;
	slack?: SlackCredentials;
}

export function integrationFiles(stateDir: string) {
	const kept = (name: string) => {
		const file = join(stateDir, `agent-workplace-${name}`);
		const old = join(stateDir, `agent-world-${name}`);
		if (!existsSync(file) && existsSync(old)) renameSync(old, file);
		return file;
	};
	return {
		credentials: kept("credentials.json"),
		record: kept("outside-writes.jsonl"),
		recentPages: kept("library-recent.json"),
	};
}

export interface CredentialStore {
	read(): StoredCredentials;
	set<K extends keyof StoredCredentials>(account: K, value: StoredCredentials[K] | undefined): void;
	status(): CredentialStatus;
}

export function writePrivate(file: string, text: string) {
	mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
	const temporary = `${file}.${process.pid}.tmp`;
	const fd = openSync(temporary, "w", 0o600);
	try {
		writeSync(fd, text);
	} finally {
		closeSync(fd);
	}
	chmodSync(temporary, 0o600);
	renameSync(temporary, file);
}

export function openCredentials(file: string): CredentialStore {
	const read = (): StoredCredentials => {
		if (!existsSync(file)) return {};
		if ((statSync(file).mode & 0o077) !== 0) chmodSync(file, 0o600);
		try {
			const value = JSON.parse(readFileSync(file, "utf8")) as unknown;
			return value && typeof value === "object" ? (value as StoredCredentials) : {};
		} catch {
			return {};
		}
	};
	return {
		read,
		set(account, value) {
			const next = { ...read(), [account]: value };
			if (value === undefined) delete next[account];
			if (!next.atlassian && !next.slack) {
				rmSync(file, { force: true });
				return;
			}
			writePrivate(file, `${JSON.stringify(next, null, "\t")}\n`);
		},
		status() {
			const { atlassian, slack } = read();
			return {
				atlassian: atlassian ? { site: atlassian.site, email: atlassian.email } : null,
				slack: slack
					? {
							team: slack.team ?? null,
							url: slack.url ?? null,
							user: slack.user ?? null,
							sendAsMe: slack.sendAsMe === true,
						}
					: null,
			};
		},
	};
}
