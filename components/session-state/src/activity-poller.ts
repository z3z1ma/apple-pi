// Reads each followed source once a minute, keeps its new items and cursor in one transaction, and in the same
// transaction posts the items the desk should triage to the coordinator's activity thread. A failed read records its
// reason on the source and keeps the cursor, so the next read covers the gap.
import type { DatabaseSync } from "node:sqlite";
import {
	integrationFiles,
	openCredentials,
} from "../../../apps/agent-workplace/src/backend/integrations/credentials.js";
import {
	ACTIVITY_SOURCES,
	type ActivitySource,
	activityCursor,
	forTriage,
	markDelivered,
	recordActivity,
	setActivityCursor,
	triageBatch,
	triageModes,
} from "./activity.js";
import { readGitHub, readJira, readSlack, type SourceRead } from "./activity-sources.js";
import type { ExternalCommit } from "./external-threads.js";

export const ACTIVITY_POLL_MS = 60_000;

export function deskPerson(db: DatabaseSync): string | undefined {
	const row = db.prepare("select value from preferences where key = 'desk'").get() as { value: string } | undefined;
	try {
		return row ? (JSON.parse(row.value) as { person?: string }).person : undefined;
	} catch {
		return undefined;
	}
}

type Read = (
	source: ActivitySource,
	cursor: string | undefined,
	now: number,
	signal: AbortSignal,
) => Promise<SourceRead>;

/** The real sources, with the credentials Workplace keeps beside the runtime's state. */
export const readSource =
	(stateDir: string): Read =>
	(source, cursor, now, signal) => {
		if (source === "github") return readGitHub(cursor, now, signal);
		const credentials = openCredentials(integrationFiles(stateDir).credentials).read();
		return source === "jira"
			? readJira(credentials.atlassian, cursor, now, signal)
			: readSlack(credentials.slack, cursor, now, signal);
	};

export class ActivityPoller {
	private readonly abort = new AbortController();
	private polling = false;
	private readonly db: DatabaseSync;
	private readonly commit: ExternalCommit;
	private readonly source: Read;

	constructor(db: DatabaseSync, commit: ExternalCommit, source: Read) {
		this.db = db;
		this.commit = commit;
		this.source = source;
	}

	stop(): void {
		this.abort.abort();
	}

	private read(source: ActivitySource, cursor: string | undefined, now: number): Promise<SourceRead> {
		return this.source(source, cursor, now, this.abort.signal);
	}

	async poll(): Promise<void> {
		if (this.polling) return;
		this.polling = true;
		try {
			const modes = triageModes(this.db);
			for (const source of ACTIVITY_SOURCES) {
				if (modes[source] === "off" || this.abort.signal.aborted) continue;
				const now = Date.now();
				let read: SourceRead;
				try {
					read = await this.read(source, activityCursor(this.db, source), now);
				} catch (error) {
					if (this.abort.signal.aborted) return;
					setActivityCursor(this.db, source, undefined, now, (error as Error).message);
					continue;
				}
				if (this.abort.signal.aborted) return;
				this.commit((publish) => {
					const fresh = recordActivity(this.db, read.items, now);
					setActivityCursor(this.db, source, read.cursor, now);
					for (const [person, due] of forTriage(this.db, fresh, deskPerson(this.db))) {
						publish(
							`activity:${source}:${person}:${now}`,
							{
								thread: `activity:${person}`,
								subject: "Outside activity to triage",
								to: [person],
								notify: [person],
								body: triageBatch(due),
							},
							now,
						);
						markDelivered(
							this.db,
							due.map((item) => item.id),
							now,
						);
					}
				});
			}
		} finally {
			this.polling = false;
		}
	}
}
