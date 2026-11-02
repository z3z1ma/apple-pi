import { execFile } from "node:child_process";
import type { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import { atlassianRequest } from "../../../apps/agent-world/src/backend/integrations/atlassian.js";
import {
	type AtlassianCredentials,
	integrationFiles,
	openCredentials,
} from "../../../apps/agent-world/src/backend/integrations/credentials.js";
import { adfText } from "../../../apps/agent-world/src/backend/integrations/jira.js";
import { HARNESS, OPERATOR, participateIn, type ThreadPost } from "./threads.js";

export type ExternalCommand =
	| { kind: "external"; action: "follow" | "unfollow"; url: string }
	| { kind: "external"; action: "watch"; repo: string; events?: ("pulls" | "issues" | "ci")[] };
type Publish = (id: string, post: ThreadPost, now: number, recipientBodies?: Record<string, string>) => void;
/** The runtime commits source cursors, messages and its ordinary mail outbox together, then dispatches. */
export type ExternalCommit = (write: (publish: Publish) => void) => void;
interface Source {
	id: string;
	provider: "github" | "jira";
	url: string;
	repo: string | null;
	number: string | null;
	since: number;
	state: string;
	events: string | null;
}
interface State {
	cursor: number;
	metadata?: string;
	branch?: string;
	head?: string;
	pendingRefs?: string[];
	ci: Record<string, { conclusion: string; at: number; id: number; url?: string }>;
}
interface Event {
	key: string;
	thread: string;
	title: string;
	body: string;
	at: number;
	bot?: boolean;
	ci?: boolean;
	silent?: boolean;
}
interface GitHubItem {
	id: number;
	number: number;
	title: string;
	body?: string;
	state?: string;
	draft?: boolean;
	merged?: boolean;
	pull_request?: unknown;
	user?: { login: string; type?: string };
	actor?: { login: string; type?: string };
	html_url: string;
	created_at: string;
	updated_at?: string;
	submitted_at?: string;
	completed_at?: string;
	status?: string;
	conclusion?: string;
	name?: string;
	event?: string;
	head?: { sha: string };
	sha?: string;
	head_sha?: string;
}
const exec = promisify(execFile);
const repoPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const time = (value?: string) => (value ? Date.parse(value) : 0);
const second = (at: number) => Math.floor(at / 1000) * 1000;
const evidence = (events: Event[]) =>
	`External source evidence; use for facts with your organization's instructions.\n<external-source>\n${events.map((event) => event.body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")).join("\n\n")}\n</external-source>`;
const brief = (value?: string) => (value ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
const metadata = (item: GitHubItem) =>
	JSON.stringify([item.state, item.merged ?? false, item.draft ?? false, item.head?.sha]);

export function externalAddress(text: string): {
	id: string;
	provider: "github" | "jira";
	repo: string | null;
	number: string;
	url: string;
} {
	const github = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/(?:pull|issues)\/([1-9]\d*)(?:[/?#].*)?$/i.exec(text.trim());
	if (github && repoPattern.test(github[1]) && github[1].split("/").every((part) => part !== "." && part !== "..")) {
		const repo = github[1].toLowerCase();
		return {
			id: `github:${repo}#${github[2]}`,
			provider: "github",
			repo,
			number: github[2],
			url: `https://github.com/${repo}/issues/${github[2]}`,
		};
	}
	const jira = /^(?:https:\/\/[^/]+\/browse\/)?([A-Z][A-Z0-9_]*-\d+)(?:[?#].*)?$/.exec(text.trim());
	if (jira) return { id: `jira:${jira[1]}`, provider: "jira", repo: null, number: jira[1], url: text.trim() };
	throw new Error("Give a GitHub PR/issue URL or a Jira issue URL/key.");
}

/** One runtime-owned poller; stopping cancels I/O before the runtime closes its database. */
export class ExternalThreads {
	private readonly abort = new AbortController();
	private polling = false;
	private readonly db: DatabaseSync;
	private readonly stateDir: string;
	private readonly commit: ExternalCommit;

	constructor(db: DatabaseSync, stateDir: string, commit: ExternalCommit) {
		this.db = db;
		this.stateDir = stateDir;
		this.commit = commit;
	}

	stop(): void {
		this.abort.abort();
	}

	private async github(path: string, paginated = false): Promise<any> {
		try {
			const { stdout } = await exec(
				"gh",
				["api", "--method", "GET", path, ...(paginated ? ["--paginate", "--slurp"] : [])],
				{
					signal: this.abort.signal,
					timeout: 30_000,
					maxBuffer: 64 * 1024 * 1024,
				},
			);
			return JSON.parse(stdout);
		} catch (error) {
			const message =
				(error as NodeJS.ErrnoException).code === "ENOENT"
					? "GitHub polling unavailable: install gh and sign in with gh auth login."
					: /gh auth login|not logged in|authentication|HTTP 401/i.test(String((error as { stderr?: string }).stderr))
						? "GitHub polling unavailable: sign in with gh auth login."
						: `GitHub request failed: ${path.split("?")[0]}`;
			if (!this.abort.signal.aborted) this.recordError("github", message);
			throw new Error(message);
		}
	}

	private async githubList(path: string, field?: string): Promise<GitHubItem[]> {
		const pages = await this.github(`${path}${path.includes("?") ? "&" : "?"}per_page=100`, true);
		return pages.flatMap((page: any) => (field ? page[field] : page));
	}

	private credentials(): AtlassianCredentials | undefined {
		return openCredentials(integrationFiles(this.stateDir).credentials).read().atlassian;
	}

	private validateCredentials(snapshot: AtlassianCredentials | undefined): asserts snapshot is AtlassianCredentials {
		if (!snapshot || JSON.stringify(snapshot) !== JSON.stringify(this.credentials()))
			throw new Error("Jira sign-in changed; retry with the current Atlassian site.");
	}

	private async jira(path: string, credentials: AtlassianCredentials): Promise<any> {
		this.validateCredentials(credentials);
		const result = await atlassianRequest(credentials, path, {
			fetch: (input, init) =>
				fetch(input, {
					...init,
					signal: AbortSignal.any([this.abort.signal, init?.signal ?? AbortSignal.timeout(20_000)]),
				}),
		});
		if (!this.abort.signal.aborted) this.validateCredentials(credentials);
		if (!result.ok) throw new Error("Jira polling unavailable: check the Atlassian sign-in in Workplace Settings.");
		return result.json;
	}

	async command(person: string, command: ExternalCommand, now: number, applied: () => void = () => {}): Promise<void> {
		const finish = (write: () => void) =>
			this.commit(() => {
				write();
				applied();
			});
		now = second(now);
		const actor = this.db
			.prepare("select role, manages, reports_to from sessions where id = ? and kind = 'root' and retired_at is null")
			.get(person) as { role: string | null; manages: number | null; reports_to: string | null } | undefined;
		if (person !== OPERATOR && !actor) throw new Error("External subscriptions need a current person.");
		if (command.action === "watch") {
			if (person !== OPERATOR && actor?.manages !== 1 && !(actor?.role === null && actor.reports_to === null))
				throw new Error("Only managers can watch repositories.");
			if (!repoPattern.test(command.repo) || command.repo.split("/").some((part) => part === "." || part === ".."))
				throw new Error("Give a repository as owner/repo.");
			if (command.events?.some((event) => !["pulls", "issues", "ci"].includes(event)))
				throw new Error("Repository events are pulls, issues or ci.");
			const repo = command.repo.toLowerCase();
			const id = `repository:${repo}`;
			const existing = this.db.prepare("select id from external_sources where id = ?").get(id);
			const info = existing ? undefined : await this.github(`repos/${repo}`);
			const tip = existing
				? undefined
				: await this.github(`repos/${repo}/commits/${encodeURIComponent(info.default_branch)}`);
			if (this.abort.signal.aborted) return;
			finish(() => {
				this.db
					.prepare(
						"insert into external_sources (id, provider, url, repo, number, since, state, events) values (?, 'github', ?, ?, null, ?, ?, ?) on conflict(id) do update set events = excluded.events",
					)
					.run(
						id,
						`https://github.com/${repo}`,
						repo,
						now,
						JSON.stringify({ cursor: now, ci: {}, branch: info?.default_branch, head: tip?.sha }),
						JSON.stringify(command.events ?? ["pulls", "issues", "ci"]),
					);
			});
			return;
		}
		const address = externalAddress(command.url);
		if (command.action === "unfollow") {
			finish(() => participateIn(this.db, address.id, person, now, null));
			return;
		}
		const saved = this.db.prepare("select url from external_sources where id = ?").get(address.id) as
			| { url: string }
			| undefined;
		const credentials = address.provider === "jira" ? this.credentials() : undefined;
		if (address.provider === "jira") {
			this.validateCredentials(credentials);
			if (
				(address.url.startsWith("https://") && new URL(address.url).origin !== new URL(credentials.site).origin) ||
				(saved && new URL(saved.url).origin !== new URL(credentials.site).origin)
			)
				throw new Error(
					"This Jira key belongs to another site; its retained thread cannot represent the new site's issue.",
				);
		}
		const existing = this.db
			.prepare("select delivery from thread_participants where thread_id = ? and participant = ?")
			.get(address.id, person) as { delivery: string } | undefined;
		if (existing?.delivery === "push" && saved) {
			finish(() => {});
			return;
		}
		let title: string;
		const state: State = { cursor: now, ci: {} };
		if (address.provider === "github") {
			let item: GitHubItem = await this.github(`repos/${address.repo}/issues/${address.number}`);
			if (item.pull_request) item = await this.github(`repos/${address.repo}/pulls/${address.number}`);
			title = item.title;
			address.url = item.html_url;
			state.metadata = metadata(item);
			if (item.head) state.pendingRefs = [item.head.sha];
		} else {
			this.validateCredentials(credentials);
			const item = await this.jira(`/rest/api/3/issue/${address.number}?fields=summary,status`, credentials);
			title = item.fields.summary;
			state.metadata = item.fields.status?.name;
			address.url = `${credentials.site}/browse/${address.number}`;
			this.validateCredentials(credentials);
		}
		if (this.abort.signal.aborted) return;
		finish(() => {
			const followers = this.followers(address.id);
			this.ensureThread(address.id, title, now);
			this.db
				.prepare(
					"insert into external_sources (id, provider, url, repo, number, since, state) values (?, ?, ?, ?, ?, ?, ?) on conflict(id) do nothing",
				)
				.run(address.id, address.provider, address.url, address.repo, address.number, now, JSON.stringify(state));
			if (!followers) {
				this.db
					.prepare("update external_sources set since = ?, state = ? where id = ?")
					.run(now, JSON.stringify(state), address.id);
			}
			participateIn(this.db, address.id, person, now, "push");
			this.db
				.prepare(
					"update thread_participants set delivery = 'push', joined_at = ? where thread_id = ? and participant = ? and delivery != 'push'",
				)
				.run(now, address.id, person);
		});
	}

	private followers(thread: string): boolean {
		return Boolean(
			this.db
				.prepare(
					"select 1 from thread_participants p where p.thread_id = ? and p.delivery = 'push' and (p.participant = 'operator' or exists (select 1 from sessions s where s.id = p.participant and s.retired_at is null))",
				)
				.get(thread),
		);
	}

	private ensureThread(id: string, title: string, now: number): void {
		this.db
			.prepare(
				"insert into threads (id, kind, subject, created_by, created_at) values (?, 'mail', ?, ?, ?) on conflict(id) do update set subject = excluded.subject",
			)
			.run(id, title, HARNESS, now);
		participateIn(this.db, id, HARNESS, now, "pull");
	}

	async poll(): Promise<void> {
		if (this.polling || this.abort.signal.aborted) return;
		this.polling = true;
		try {
			const sources = this.db.prepare("select * from external_sources").all() as unknown as Source[];
			for (const source of sources) {
				if (this.abort.signal.aborted) return;
				const policy = this.db
					.prepare("select policy, ignore_bots from external_policies where provider = ?")
					.get(source.provider) as { policy: string; ignore_bots: number };
				if (policy.policy === "ignore" || (source.events ? policy.policy !== "candidate" : !this.followers(source.id)))
					continue;
				const state = JSON.parse(source.state) as State;
				for (const [name, entry] of Object.entries(state.ci)) {
					if (typeof entry === "string") state.ci[name] = { conclusion: entry, at: source.since - 1, id: 0 };
				}
				try {
					const now = Date.now();
					const credentials = source.provider === "jira" ? this.credentials() : undefined;
					const events =
						source.provider === "github"
							? await this.githubEvents(source, state)
							: await this.jiraEvents(source, state, credentials);
					if (this.abort.signal.aborted) return;
					this.commit((publish) => {
						if (source.provider === "jira") this.validateCredentials(credentials);
						const current = this.db.prepare("select state, events from external_sources where id = ?").get(source.id) as
							| { state: string; events: string | null }
							| undefined;
						if (current?.state !== source.state || current.events !== source.events) return;
						const fresh = events.filter(
							(event) =>
								!event.silent &&
								event.at >= source.since &&
								(!policy.ignore_bots || !event.bot || event.ci) &&
								!this.db
									.prepare("select 1 from external_seen where source = ? and event = ?")
									.get(source.id, event.key),
						);
						this.postEvents(source, fresh, publish, now);
						for (const event of events)
							this.db
								.prepare("insert into external_seen (source, event) values (?, ?) on conflict do nothing")
								.run(source.id, event.key);
						state.cursor = now;
						this.db.prepare("update external_sources set state = ? where id = ?").run(JSON.stringify(state), source.id);
						this.db.prepare("update external_policies set last_error = null where provider = ?").run(source.provider);
					});
				} catch (error) {
					if (this.abort.signal.aborted) return;
					this.recordError(source.provider, (error as Error).message);
				}
			}
		} finally {
			this.polling = false;
		}
	}

	private recordError(provider: string, message: string): void {
		const previous = this.db.prepare("select last_error from external_policies where provider = ?").get(provider) as {
			last_error: string | null;
		};
		if (previous.last_error === message) return;
		this.db.prepare("update external_policies set last_error = ? where provider = ?").run(message, provider);
		this.db
			.prepare("insert into events (at, source, type, data) values (?, 'runtime', 'external_poll_failed', ?)")
			.run(Date.now(), JSON.stringify({ provider, message }));
	}

	private postEvents(source: Source, events: Event[], publish: Publish, now: number): void {
		const groups = new Map<string, Event[]>();
		for (const event of events) groups.set(event.thread, [...(groups.get(event.thread) ?? []), event]);
		const desk: string[] = [];
		for (const [thread, items] of groups) {
			this.ensureThread(thread, items.at(-1)!.title, now);
			const members = this.db
				.prepare(
					"select p.participant, p.joined_at from thread_participants p where p.thread_id = ? and p.delivery = 'push' and (p.participant = 'operator' or exists (select 1 from sessions s where s.id = p.participant and s.retired_at is null))",
				)
				.all(thread) as { participant: string; joined_at: number }[];
			const recipientBodies: Record<string, string> = {};
			for (const member of members) {
				const eligible = items.filter((event) => event.at >= second(member.joined_at));
				if (eligible.length) recipientBodies[member.participant] = evidence(eligible);
			}
			const body = evidence(items);
			const id = `external:${source.id}:${items.map((event) => event.key).join(":")}`;
			publish(id, { thread, body }, now, recipientBodies);
			const unassigned = items.filter((event) => !members.some((member) => event.at >= second(member.joined_at)));
			if (unassigned.length) desk.push(`${thread}\n${evidence(unassigned)}`);
		}
		if (!desk.length) return;
		const preference = this.db.prepare("select value from preferences where key = 'desk'").get() as
			| { value: string }
			| undefined;
		let configured: { thread: string; person: string } | undefined;
		try {
			configured = preference ? JSON.parse(preference.value) : undefined;
		} catch {
			/* Invalid persisted preference uses the same fallback as an absent desk. */
		}
		if (
			preference &&
			(!configured ||
				!this.db
					.prepare(
						"select 1 from threads t join sessions s on s.id = ? where t.id = ? and t.kind = 'channel' and t.closed_at is null and s.kind = 'root' and s.retired_at is null",
					)
					.get(configured.person, configured.thread))
		) {
			const data = JSON.stringify({
				message: "Configured external desk is unavailable; using the fallback.",
				preference: preference.value,
			});
			const previous = this.db
				.prepare("select data from events where type = 'external_desk_unavailable' order by seq desc limit 1")
				.get() as { data: string } | undefined;
			if (previous?.data !== data)
				this.db
					.prepare("insert into events (at, source, type, data) values (?, 'runtime', 'external_desk_unavailable', ?)")
					.run(now, data);
			configured = undefined;
		}
		const fallback = this.db
			.prepare(
				"select id from sessions where kind = 'root' and reports_to is null and on_call = 1 and retired_at is null order by updated_at desc limit 1",
			)
			.get() as { id: string } | undefined;
		const person = configured?.person ?? fallback?.id ?? OPERATOR;
		const fallbackId = `external:desk:${person}`;
		const open = this.db
			.prepare(
				"select id from threads where (id = ? or id like ?) and closed_at is null order by created_at desc limit 1",
			)
			.get(fallbackId, `${fallbackId}:%`) as { id: string } | undefined;
		const retained = this.db.prepare("select 1 from threads where id = ?").get(fallbackId);
		const thread = configured?.thread ?? open?.id ?? (retained ? `${fallbackId}:${now}` : fallbackId);
		if (configured) participateIn(this.db, thread, HARNESS, now, "pull");
		publish(
			`external:desk:${source.id}:${events.map((event) => event.key).join(":")}`,
			{ thread, subject: "External activity", to: [person], notify: [person], body: desk.join("\n\n") },
			now,
		);
	}

	private event(source: Source, item: GitHubItem, action: string, key: string, at?: string): Event {
		const author = item.user ?? item.actor;
		return {
			key,
			thread: source.id,
			title: item.title ?? source.id,
			at: time(at ?? item.created_at),
			bot: author?.type === "Bot" || /\[bot\]$/.test(author?.login ?? ""),
			body: `${author?.login ?? "GitHub"} ${action}${item.body ? `: ${brief(item.body)}` : ""}\n${item.html_url ?? source.url}`,
		};
	}

	private async githubEvents(source: Source, state: State): Promise<Event[]> {
		if (source.events) return this.repositoryEvents(source, state);
		const base = `repos/${source.repo}`;
		let item: GitHubItem = await this.github(`${base}/issues/${source.number}`);
		const pull = Boolean(item.pull_request);
		if (pull) item = await this.github(`${base}/pulls/${source.number}`);
		const title = item.title;
		const events: Event[] = [];
		const previousHead = state.metadata ? JSON.parse(state.metadata)[3] : undefined;
		const snapshot = metadata(item);
		if (state.metadata !== snapshot)
			events.push(
				this.event(
					source,
					item,
					`updated ${pull ? "PR" : "issue"} (${item.merged ? "merged" : item.state})`,
					`state:${snapshot}:${item.updated_at}`,
					item.updated_at,
				),
			);
		state.metadata = snapshot;
		const since = encodeURIComponent(new Date(Math.max(source.since - 1000, state.cursor - 1000)).toISOString());
		for (const comment of await this.githubList(`${base}/issues/${source.number}/comments?since=${since}`))
			events.push(
				this.event(source, comment, "commented", `comment:${comment.id}:${comment.updated_at}`, comment.updated_at),
			);
		for (const change of await this.githubList(`${base}/issues/${source.number}/events`))
			events.push(this.event(source, change, change.event ?? "updated issue", `event:${change.id}`));
		if (pull) {
			for (const review of await this.githubList(`${base}/pulls/${source.number}/reviews`))
				events.push(
					this.event(
						source,
						review,
						`reviewed (${review.state})`,
						`review:${review.id}:${review.submitted_at}`,
						review.submitted_at,
					),
				);
			for (const comment of await this.githubList(`${base}/pulls/${source.number}/comments?since=${since}`))
				events.push(
					this.event(
						source,
						comment,
						"commented on the diff",
						`review-comment:${comment.id}:${comment.updated_at}`,
						comment.updated_at,
					),
				);
			const commits = await this.githubList(`${base}/pulls/${source.number}/commits`);
			events.push(
				...(await this.checkEvents(source, state, [
					...commits.map((commit) => commit.sha!),
					item.head!.sha,
					...(previousHead ? [previousHead] : []),
				])),
			);
		}
		return events.map((event) => ({ ...event, title })).sort((a, b) => a.at - b.at);
	}

	private async checkEvents(source: Source, state: State, refs: string[]): Promise<Event[]> {
		const checks: GitHubItem[] = [];
		const pending: string[] = [];
		for (const ref of new Set([...refs, ...(state.pendingRefs ?? [])])) {
			const runs = await this.githubList(
				`repos/${source.repo}/commits/${encodeURIComponent(ref)}/check-runs?filter=all`,
				"check_runs",
			);
			if (this.abort.signal.aborted) return [];
			if (!runs.length || runs.some((run) => run.status !== "completed")) pending.push(ref);
			checks.push(...runs);
		}
		state.pendingRefs = pending;
		const events: Event[] = [];
		for (const check of checks.sort((a, b) => time(a.completed_at) - time(b.completed_at) || a.id - b.id)) {
			if (check.status !== "completed" || !check.conclusion) continue;
			const key = `check:${check.id}:${check.conclusion}:${check.completed_at}`;
			const name = check.name ?? "CI";
			if (this.db.prepare("select 1 from external_seen where source = ? and event = ?").get(source.id, key)) {
				if (state.ci[name]?.id === check.id) state.ci[name].url = check.html_url ?? source.url;
				continue;
			}
			const failed = ["failure", "timed_out", "cancelled", "action_required", "startup_failure"].includes(
				check.conclusion,
			);
			const previous = state.ci[name];
			const at = time(check.completed_at);
			const newer = !previous || at > previous.at || (at === previous.at && check.id > previous.id);
			const recovery = newer && check.conclusion === "success" && previous?.conclusion === "failure";
			const event = this.event(
				source,
				check,
				`${name}: ${failed ? check.conclusion : "recovered (success)"}`,
				key,
				check.completed_at,
			);
			if (failed && !newer && previous?.conclusion === "success") {
				const recoveryUrl = previous.url ?? checks.find((run) => run.id === previous.id)?.html_url ?? source.url;
				event.body += `\nAlready recovered (success) at ${new Date(previous.at).toISOString()}\n${recoveryUrl}`;
			}
			events.push({ ...event, ci: true, silent: !failed && !recovery });
			if (newer && (failed || check.conclusion === "success"))
				state.ci[name] = {
					conclusion: failed ? "failure" : "success",
					at,
					id: check.id,
					url: check.html_url ?? source.url,
				};
		}
		return events;
	}

	private async repositoryEvents(source: Source, state: State): Promise<Event[]> {
		const selected = JSON.parse(source.events!) as string[];
		const events: Event[] = [];
		const since = encodeURIComponent(new Date(Math.max(source.since - 1000, state.cursor - 1000)).toISOString());
		if (selected.includes("pulls") || selected.includes("issues")) {
			for (const item of await this.githubList(`repos/${source.repo}/issues?state=all&since=${since}`)) {
				if (!selected.includes(item.pull_request ? "pulls" : "issues")) continue;
				events.push({
					...this.event(
						source,
						item,
						`opened ${item.pull_request ? "PR" : "issue"} #${item.number}: ${item.title}`,
						`opened:${item.number}`,
					),
					thread: `github:${source.repo}#${item.number}`,
				});
			}
		}
		if (selected.includes("ci")) {
			const tip = (await this.github(`repos/${source.repo}/commits/${encodeURIComponent(state.branch!)}`)) as {
				sha: string;
			};
			const refs = [tip.sha];
			if (state.head && state.head !== tip.sha) {
				refs.push(state.head);
				const commits = await this.githubList(`repos/${source.repo}/compare/${state.head}...${tip.sha}`, "commits");
				refs.push(...commits.map((commit) => commit.sha!));
			}
			events.push(...(await this.checkEvents(source, state, refs)));
			state.head = tip.sha;
		}
		return events.sort((a, b) => a.at - b.at);
	}

	private async jiraEvents(
		source: Source,
		state: State,
		credentials: AtlassianCredentials | undefined,
	): Promise<Event[]> {
		this.validateCredentials(credentials);
		if (!credentials || new URL(source.url).origin !== new URL(credentials.site).origin)
			throw new Error("Jira polling unavailable: the followed issue belongs to another Atlassian site.");
		const item = await this.jira(`/rest/api/3/issue/${source.number}?fields=summary,status,updated`, credentials);
		const events: Event[] = [];
		state.metadata = item.fields.status?.name;
		let historyStart = 0;
		for (;;) {
			const page = await this.jira(`/rest/api/3/issue/${source.number}/changelog?startAt=${historyStart}`, credentials);
			for (const change of page.values)
				events.push({
					key: `change:${change.id}`,
					thread: source.id,
					title: item.fields.summary,
					at: time(change.created),
					bot: change.author?.accountType === "app",
					body: `${change.author?.displayName ?? "Jira"} changed ${brief(change.items.map((field: any) => `${field.field}: ${field.fromString ?? "(empty)"} -> ${field.toString ?? "(empty)"}`).join("; "))}\n${source.url}`,
				});
			historyStart += page.values.length;
			if (page.isLast || historyStart >= page.total || !page.values.length) break;
		}
		let start = 0;
		for (;;) {
			const page = await this.jira(`/rest/api/3/issue/${source.number}/comment?startAt=${start}`, credentials);
			for (const comment of page.comments)
				events.push({
					key: `comment:${comment.id}:${comment.updated}`,
					thread: source.id,
					title: item.fields.summary,
					at: time(comment.updated ?? comment.created),
					bot: comment.author?.accountType === "app",
					body: `${comment.author?.displayName ?? "Jira"} commented: ${brief(adfText(comment.body))}\n${source.url}?focusedCommentId=${comment.id}`,
				});
			start += page.comments.length;
			if (start >= page.total || !page.comments.length) break;
		}
		return events.sort((a, b) => a.at - b.at);
	}
}
