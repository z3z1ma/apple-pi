// The quest office's Jira: REST API v3 with the operator's email and API token. Reads his open issues (assigned and
// not done, no sprint filter), text search across every issue, one issue with its comments, and the transitions Jira
// allows now; writes (comment, transition) only through the outside-write gate (`gate.ts`).
// Endpoints: POST /rest/api/3/search/jql (the old /search is deprecated), GET /rest/api/3/issue/{key}?expand=
// renderedFields, GET and POST /rest/api/3/issue/{key}/transitions, POST /rest/api/3/issue/{key}/comment (ADF body).
import type { JiraComment, JiraIssue, JiraIssueDetail, JiraTransition, Outcome, Refusal } from "../../integrations.js";
import { atlassianRequest, type Fetch, htmlText, queryText } from "./atlassian.js";
import type { AtlassianCredentials } from "./credentials.js";

const FIELDS = ["summary", "status", "issuetype", "priority", "project", "assignee", "updated"];
const LIST_MAX = 50;
export const ASSIGNED_JQL = "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC";
const KEY = /^[A-Z][A-Z0-9_]*-\d+$/;

export function issueKey(text: unknown): string | undefined {
	if (typeof text !== "string") return undefined;
	const key = text.trim().toUpperCase();
	return KEY.test(key) ? key : undefined;
}

type Fields = Record<string, unknown>;
const name = (value: unknown, field = "name"): string | null => {
	const named = value as Record<string, unknown> | null | undefined;
	return named && typeof named[field] === "string" ? (named[field] as string) : null;
};

function toIssue(site: string, raw: unknown): JiraIssue {
	const issue = raw as { key: string; fields?: Fields };
	const fields = issue.fields ?? {};
	const status = fields.status as { name?: string; statusCategory?: { key?: string } } | undefined;
	return {
		key: issue.key,
		summary: typeof fields.summary === "string" ? fields.summary : "",
		status: name(status),
		statusCategory: status?.statusCategory?.key ?? null,
		type: name(fields.issuetype),
		priority: name(fields.priority),
		project: name(fields.project, "key"),
		assignee: name(fields.assignee, "displayName"),
		updated: typeof fields.updated === "string" ? fields.updated : null,
		url: `${site}/browse/${issue.key}`,
	};
}

/** Atlassian Document Format to plain text: paragraphs and list items on their own lines. */
export function adfText(node: unknown): string {
	const walk = (value: unknown): string => {
		if (!value || typeof value !== "object") return "";
		const { type, text, attrs, content } = value as {
			type?: string;
			text?: string;
			attrs?: Record<string, unknown>;
			content?: unknown[];
		};
		const inner = Array.isArray(content) ? content.map(walk).join("") : "";
		switch (type) {
			case "text":
				return text ?? "";
			case "hardBreak":
				return "\n";
			case "mention":
				return typeof attrs?.text === "string" ? attrs.text : "@someone";
			case "emoji":
				return typeof attrs?.shortName === "string" ? attrs.shortName : "";
			case "inlineCard":
			case "blockCard":
				return typeof attrs?.url === "string" ? attrs.url : "";
			case "listItem":
				return `- ${inner.trim()}\n`;
			case "paragraph":
			case "heading":
			case "codeBlock":
			case "blockquote":
			case "rule":
				return `${inner}\n\n`;
			default:
				return inner;
		}
	};
	return walk(node)
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/** Plain text as an ADF document: blank lines part paragraphs, single newlines become hard breaks. */
export function textAdf(text: string) {
	const paragraphs = text
		.replace(/\r\n/g, "\n")
		.split(/\n\s*\n/)
		.filter((part) => part.trim());
	return {
		type: "doc",
		version: 1,
		content: paragraphs.map((paragraph) => ({
			type: "paragraph",
			content: paragraph
				.split("\n")
				.flatMap((line, index) => [
					...(index > 0 ? [{ type: "hardBreak" }] : []),
					...(line ? [{ type: "text", text: line }] : []),
				]),
		})),
	};
}

export interface Jira {
	myself(): Promise<Outcome<{ name: string | null }>>;
	assigned(): Promise<Outcome<{ issues: JiraIssue[] }>>;
	search(text: string): Promise<Outcome<{ issues: JiraIssue[] }>>;
	issue(key: string): Promise<Outcome<{ detail: JiraIssueDetail }>>;
	transitions(key: string): Promise<Outcome<{ transitions: JiraTransition[] }>>;
	/** Writes: only the gate calls these. */
	comment(key: string, body: string): Promise<Outcome<{ url: string }>>;
	transition(key: string, transitionId: string): Promise<Outcome<{ url: string }>>;
}

export function openJira(credentials: () => AtlassianCredentials | undefined, fetchImpl?: Fetch): Jira {
	const request = (path: string, options: { method?: string; body?: unknown } = {}) =>
		atlassianRequest(credentials(), path, { ...options, fetch: fetchImpl });
	const site = () => credentials()?.site ?? "";
	const badKey: Refusal = { ok: false, reason: "That is not a Jira issue key." };

	const jql = async (query: string): Promise<Outcome<{ issues: JiraIssue[] }>> => {
		const answer = await request("/rest/api/3/search/jql", {
			method: "POST",
			body: { jql: query, fields: FIELDS, maxResults: LIST_MAX },
		});
		if (!answer.ok) return answer;
		const issues = (answer.json as { issues?: unknown[] } | null)?.issues ?? [];
		return { ok: true, issues: issues.map((issue) => toIssue(site(), issue)) };
	};

	return {
		async myself() {
			const answer = await request("/rest/api/3/myself");
			if (!answer.ok) return answer;
			return { ok: true, name: name(answer.json, "displayName") };
		},
		assigned: () => jql(ASSIGNED_JQL),
		async search(text) {
			const words = queryText(text);
			if (!words) return { ok: true, issues: [] };
			const found = await jql(`text ~ "${words}" ORDER BY updated DESC`);
			const key = issueKey(text);
			if (!key || !found.ok) return found;
			// A key finds its issue, even where text search would not.
			const exact = await request(`/rest/api/3/issue/${key}?fields=${FIELDS.join(",")}`);
			if (!exact.ok) return found;
			const issue = toIssue(site(), exact.json);
			return { ok: true, issues: [issue, ...found.issues.filter((other) => other.key !== issue.key)] };
		},
		async issue(given) {
			const key = issueKey(given);
			if (!key) return badKey;
			const fields = [...FIELDS, "description", "comment", "reporter", "created"].join(",");
			const answer = await request(`/rest/api/3/issue/${key}?fields=${fields}&expand=renderedFields`);
			if (!answer.ok) return answer;
			const raw = answer.json as { fields?: Fields; renderedFields?: Fields };
			const fields_ = raw.fields ?? {};
			const rendered = raw.renderedFields ?? {};
			const comments = ((fields_.comment as { comments?: unknown[] } | undefined)?.comments ?? []) as {
				id: string;
				author?: unknown;
				created?: string;
				body?: unknown;
			}[];
			const renderedComments = ((rendered.comment as { comments?: unknown[] } | undefined)?.comments ?? []) as {
				id: string;
				body?: unknown;
			}[];
			const htmlOf = new Map(renderedComments.map((comment) => [comment.id, comment.body]));
			const descriptionHtml = typeof rendered.description === "string" ? rendered.description : null;
			return {
				ok: true,
				detail: {
					issue: toIssue(site(), raw),
					reporter: name(fields_.reporter, "displayName"),
					created: typeof fields_.created === "string" ? fields_.created : null,
					descriptionHtml,
					descriptionText: fields_.description
						? adfText(fields_.description)
						: descriptionHtml
							? htmlText(descriptionHtml)
							: "",
					comments: comments.map((comment): JiraComment => {
						const html = htmlOf.get(comment.id);
						return {
							id: comment.id,
							author: name(comment.author, "displayName"),
							created: comment.created ?? null,
							html: typeof html === "string" ? html : null,
							text: comment.body ? adfText(comment.body) : typeof html === "string" ? htmlText(html) : "",
						};
					}),
				},
			};
		},
		async transitions(given) {
			const key = issueKey(given);
			if (!key) return badKey;
			const answer = await request(`/rest/api/3/issue/${key}/transitions`);
			if (!answer.ok) return answer;
			const transitions = ((answer.json as { transitions?: unknown[] } | null)?.transitions ?? []) as {
				id: string;
				name: string;
				isAvailable?: boolean;
				to?: { name?: string; statusCategory?: { key?: string } };
			}[];
			return {
				ok: true,
				transitions: transitions
					.filter((transition) => transition.isAvailable !== false)
					.map((transition) => ({
						id: String(transition.id),
						name: transition.name,
						to: transition.to?.name ?? null,
						toCategory: transition.to?.statusCategory?.key ?? null,
					})),
			};
		},
		async comment(given, body) {
			const key = issueKey(given);
			if (!key) return badKey;
			const answer = await request(`/rest/api/3/issue/${key}/comment`, {
				method: "POST",
				body: { body: textAdf(body) },
			});
			if (!answer.ok) return answer;
			const id = (answer.json as { id?: unknown } | null)?.id;
			return {
				ok: true,
				url: `${site()}/browse/${key}${typeof id === "string" ? `?focusedCommentId=${id}` : ""}`,
			};
		},
		async transition(given, transitionId) {
			const key = issueKey(given);
			if (!key) return badKey;
			const answer = await request(`/rest/api/3/issue/${key}/transitions`, {
				method: "POST",
				body: { transition: { id: transitionId } },
			});
			if (!answer.ok) return answer;
			return { ok: true, url: `${site()}/browse/${key}` };
		},
	};
}
