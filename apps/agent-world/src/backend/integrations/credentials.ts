// The operator's sign-ins for Atlassian and Slack: one private (0600) JSON file under the session-state directory,
// read and written only here, in Electron's main process (decision 07). Nothing in this module logs, and `status` is
// the only view of it the renderer gets: no token, cookie, or password ever leaves the backend.
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
	/** The site's origin, `https://acme.atlassian.net`. */
	site: string;
	email: string;
	token: string;
}

export interface SlackCredentials {
	/** The web client's session token, `xoxc-...`. */
	token: string;
	/** The `d` cookie's value, sent as `Cookie: d=<value>`. */
	cookie: string;
	team: string | null;
	/** The workspace address, `https://acme.slack.com/`; its `api/` serves the Web API. */
	url: string | null;
	user: string | null;
}

export interface StoredCredentials {
	atlassian?: AtlassianCredentials;
	slack?: SlackCredentials;
}

/** The files Agent World keeps beside the runtime's state. */
export function integrationFiles(stateDir: string) {
	return {
		credentials: join(stateDir, "agent-world-credentials.json"),
		record: join(stateDir, "agent-world-outside-writes.jsonl"),
		recentPages: join(stateDir, "agent-world-library-recent.json"),
	};
}

export interface CredentialStore {
	read(): StoredCredentials;
	/** Replace one account's sign-in, or remove it with `undefined`. */
	set<K extends keyof StoredCredentials>(account: K, value: StoredCredentials[K] | undefined): void;
	status(): CredentialStatus;
}

/** Write `text` to `file` readable by its owner only, replacing it whole. */
export function writePrivate(file: string, text: string) {
	mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
	const temporary = `${file}.${process.pid}.tmp`;
	const fd = openSync(temporary, "w", 0o600);
	try {
		writeSync(fd, text);
	} finally {
		closeSync(fd);
	}
	chmodSync(temporary, 0o600); // an existing temporary file keeps its mode through `open`
	renameSync(temporary, file);
}

export function openCredentials(file: string): CredentialStore {
	const read = (): StoredCredentials => {
		if (!existsSync(file)) return {};
		// A file someone widened is narrowed again before it is read.
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
				slack: slack ? { team: slack.team ?? null, url: slack.url ?? null, user: slack.user ?? null } : null,
			};
		},
	};
}
