import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { openIntegrations } from "../../src/backend/integrations/index.js";
import type { OutsideWriteEntry } from "../../src/integrations.js";
import { type FakeServer, fakeServer, type Seen } from "./fakes.js";

// Seam 1 for the quest office and the library: the backend API against a fake Jira and Confluence.
const EMAIL = "op@acme.test";
const TOKEN = "ATATT-secret-api-token";
const stateDir = mkdtempSync(join(tmpdir(), "aw-atlassian-state-"));
const credentialsFile = join(stateDir, "agent-world-credentials.json");
let site: FakeServer;
let api: ReturnType<typeof openIntegrations>;
const announced: OutsideWriteEntry[] = [];
const logged: unknown[][] = [];

const fields = (key: string, project: string, summary: string, status = "To Do") => ({
	key,
	fields: {
		summary,
		status: { name: status, statusCategory: { key: status === "Done" ? "done" : "new" } },
		issuetype: { name: "Task" },
		priority: { name: "High" },
		project: { key: project },
		assignee: { displayName: "Operator" },
		updated: "2026-10-18T10:00:00.000+0000",
	},
});
const jql = (request: Seen) => (JSON.parse(request.body || "{}") as { jql?: string }).jql ?? "";
const writes = () => site.seen.filter((request) => request.method === "POST" && !request.path.endsWith("/search/jql"));

beforeAll(async () => {
	for (const method of ["log", "info", "warn", "error", "debug"] as const)
		vi.spyOn(console, method).mockImplementation((...args) => {
			logged.push(args);
		});
	site = await fakeServer();
	site.route((request) => {
		const auth = Buffer.from(`${EMAIL}:${TOKEN}`).toString("base64");
		if (request.headers.authorization !== `Basic ${auth}`) return { status: 401, json: {} };
		const path = request.path;
		if (path === "/rest/api/3/myself") return { json: { displayName: "Operator", emailAddress: EMAIL } };
		if (path === "/rest/api/3/search/jql" && request.method === "POST") {
			const query = jql(request);
			if (query.startsWith("assignee = currentUser() AND statusCategory != Done"))
				return {
					json: {
						issues: [fields("APP-1", "APP", "Build the forge"), fields("OPS-7", "OPS", "Rotate keys")],
						isLast: true,
					},
				};
			if (query.startsWith('text ~ "quench"'))
				return {
					json: { issues: [fields("APP-3", "APP", "Quench timing"), fields("WEB-9", "WEB", "Quench art", "Done")] },
				};
			if (query.startsWith('text ~ "OPS 7"')) return { json: { issues: [] } };
			return { json: { issues: [] } };
		}
		if (
			path === "/rest/api/3/issue/OPS-7" &&
			request.method === "GET" &&
			request.query.get("expand") !== "renderedFields"
		)
			return { json: fields("OPS-7", "OPS", "Rotate keys") };
		if (path === "/rest/api/3/issue/APP-1" && request.method === "GET")
			return {
				json: {
					...fields("APP-1", "APP", "Build the forge"),
					fields: {
						...fields("APP-1", "APP", "Build the forge").fields,
						reporter: { displayName: "Lead" },
						created: "2026-10-17T10:00:00.000+0000",
						description: {
							type: "doc",
							version: 1,
							content: [
								{ type: "paragraph", content: [{ type: "text", text: "Show PRs." }] },
								{
									type: "bulletList",
									content: [
										{
											type: "listItem",
											content: [{ type: "paragraph", content: [{ type: "text", text: "with CI" }] }],
										},
									],
								},
							],
						},
						comment: {
							comments: [
								{
									id: "100",
									author: { displayName: "Lead" },
									created: "2026-10-17T11:00:00.000+0000",
									body: {
										type: "doc",
										version: 1,
										content: [{ type: "paragraph", content: [{ type: "text", text: "Soon?" }] }],
									},
								},
							],
						},
					},
					renderedFields: {
						description: "<p>Show PRs.</p><ul><li>with CI</li></ul>",
						comment: { comments: [{ id: "100", body: "<p>Soon?</p>" }] },
					},
				},
			};
		if (path === "/rest/api/3/issue/APP-1/transitions" && request.method === "GET")
			return {
				json: {
					transitions: [
						{
							id: "21",
							name: "Start work",
							isAvailable: true,
							to: { name: "In Progress", statusCategory: { key: "indeterminate" } },
						},
						{ id: "31", name: "Done", to: { name: "Done", statusCategory: { key: "done" } } },
						{ id: "41", name: "Hidden", isAvailable: false, to: { name: "Blocked" } },
					],
				},
			};
		if (path === "/rest/api/3/issue/APP-1/transitions" && request.method === "POST") return { status: 204 };
		if (path === "/rest/api/3/issue/APP-1/comment" && request.method === "POST")
			return { status: 201, json: { id: "101" } };
		if (path === "/wiki/rest/api/search")
			return {
				json: {
					results: [
						{
							content: {
								id: "11",
								type: "page",
								title: "Forge runbook",
								_links: { webui: "/spaces/ENG/pages/11/Forge+runbook" },
							},
							excerpt: "how to @@@hl@@@quench@@@endhl@@@ a blade",
							resultGlobalContainer: { title: "Engineering" },
							lastModified: "2026-10-01T00:00:00.000Z",
						},
						{
							content: {
								id: "22",
								type: "page",
								title: "Smithing &amp; you",
								_links: { webui: "/spaces/HR/pages/22" },
							},
							excerpt: "",
							resultGlobalContainer: { title: "People" },
						},
					],
					_links: { base: `${site.url}/wiki` },
				},
			};
		if (path === "/wiki/api/v2/pages/11")
			return {
				json: {
					id: "11",
					title: "Forge runbook",
					spaceId: "900",
					body: { view: { value: "<h1>Runbook</h1><p>Heat, then quench.</p>" } },
					_links: { webui: "/spaces/ENG/pages/11/Forge+runbook", base: `${site.url}/wiki` },
				},
			};
		if (path === "/wiki/api/v2/pages/22")
			return {
				json: {
					id: "22",
					title: "Smithing",
					spaceId: "901",
					body: { view: { value: "<p>Hi</p>" } },
					_links: { webui: "/x" },
				},
			};
		if (path === "/wiki/api/v2/spaces/900") return { json: { id: "900", name: "Engineering" } };
		if (path === "/wiki/api/v2/spaces/901") return { json: { id: "901", name: "People" } };
		return undefined;
	});
	api = openIntegrations({
		stateDir,
		snapshot: () => ({ connected: true, headquarters: [], characters: [] }),
		commands: { send: async () => ({ ok: false, reason: "no runtime in this test" }), close() {} },
	});
	api.onOutsideWrite((entry) => announced.push(entry));
});
afterAll(async () => {
	api.close();
	await site.close();
	vi.restoreAllMocks();
	rmSync(stateDir, { recursive: true, force: true });
});

test("before sign-in, the quest office and the library ask for it", async () => {
	expect(await api.jiraAssigned()).toMatchObject({ ok: false, signIn: "atlassian" });
	expect(await api.confluenceSearch("x")).toMatchObject({ ok: false, signIn: "atlassian" });
	expect(api.credentialStatus()).toEqual({ atlassian: null, slack: null });
});

test("a wrong token is refused and not kept; a right one is kept in a 0600 file and never shown", async () => {
	expect(await api.signInAtlassian(site.url, EMAIL, "wrong")).toMatchObject({ ok: false, signIn: "atlassian" });
	expect(existsSync(credentialsFile)).toBe(false);
	expect(await api.signInAtlassian(site.url, EMAIL, TOKEN)).toEqual({ ok: true, name: "Operator" });
	expect(statSync(credentialsFile).mode & 0o777).toBe(0o600);
	expect(readFileSync(credentialsFile, "utf8")).toContain(TOKEN);
	expect(api.credentialStatus()).toEqual({ atlassian: { site: site.url, email: EMAIL }, slack: null });
	expect(JSON.stringify(api.credentialStatus())).not.toContain(TOKEN);
	expect(await api.signInAtlassian("ftp://acme", EMAIL, TOKEN)).toMatchObject({ ok: false });
});

test("the quest office lists issues assigned to the operator and not done, from every project", async () => {
	const assigned = await api.jiraAssigned();
	expect(
		assigned.ok && assigned.issues.map((issue) => [issue.key, issue.summary, issue.status, issue.project]),
	).toEqual([
		["APP-1", "Build the forge", "To Do", "APP"],
		["OPS-7", "Rotate keys", "To Do", "OPS"],
	]);
	expect(assigned.ok && assigned.issues[0].url).toBe(`${site.url}/browse/APP-1`);
	const query = jql(site.seen.filter((request) => request.path === "/rest/api/3/search/jql").at(-1)!);
	expect(query).not.toMatch(/sprint/i);
});

test("search finds matching issues in any project, and a key finds its issue", async () => {
	const found = await api.jiraSearch("quench");
	expect(found.ok && found.issues.map((issue) => `${issue.key} ${issue.status}`)).toEqual([
		"APP-3 To Do",
		"WEB-9 Done",
	]);
	const byKey = await api.jiraSearch("ops-7");
	expect(byKey.ok && byKey.issues.map((issue) => issue.key)).toEqual(["OPS-7"]);
	const quoted = await api.jiraSearch('say "hi" (now)');
	expect(quoted.ok).toBe(true);
	expect(jql(site.seen.filter((request) => request.path === "/rest/api/3/search/jql").at(-1)!)).toBe(
		'text ~ "say \\"hi\\" now" ORDER BY updated DESC',
	);
});

test("an issue reads with its description and comments, as HTML and text", async () => {
	const read = await api.jiraIssue("APP-1");
	expect(read.ok).toBe(true);
	if (!read.ok) return;
	expect(read.detail).toMatchObject({
		reporter: "Lead",
		descriptionHtml: "<p>Show PRs.</p><ul><li>with CI</li></ul>",
		descriptionText: "Show PRs.\n\n- with CI",
		comments: [{ id: "100", author: "Lead", html: "<p>Soon?</p>", text: "Soon?" }],
	});
	expect(await api.jiraIssue("../../etc")).toMatchObject({ ok: false });
});

test("moving an issue offers only the transitions Jira allows", async () => {
	const moves = await api.jiraTransitions("APP-1");
	expect(moves.ok && moves.transitions).toEqual([
		{ id: "21", name: "Start work", to: "In Progress", toCategory: "indeterminate" },
		{ id: "31", name: "Done", to: "Done", toCategory: "done" },
	]);
	expect(await api.describeWrite({ kind: "jira-transition", key: "APP-1", transition: "41" })).toMatchObject({
		ok: false,
	});
});

test("a comment and a transition reach Jira only after confirmation, and are recorded and announced", async () => {
	const comment = { kind: "jira-comment", key: "APP-1", body: "Started.\n\nPR soon." } as const;
	const move = { kind: "jira-transition", key: "APP-1", transition: "21" } as const;
	const describedComment = await api.describeWrite(comment);
	const describedMove = await api.describeWrite(move);
	expect(describedComment).toMatchObject({
		ok: true,
		description: {
			what: "Comment on Jira issue",
			where: "APP-1 on 127.0.0.1",
			text: "Started.\n\nPR soon.",
			url: `${site.url}/browse/APP-1`,
		},
	});
	expect(describedMove).toMatchObject({
		ok: true,
		description: { what: "Move Jira issue", where: "APP-1 on 127.0.0.1", text: "Start work (to In Progress)" },
	});
	if (!describedComment.ok || !describedMove.ok) return;
	expect(await api.confirmWrite(comment, describedMove.token)).toMatchObject({ ok: false });
	expect(await api.confirmWrite(move, "")).toMatchObject({ ok: false });
	expect(writes()).toEqual([]);

	expect(await api.confirmWrite(comment, describedComment.token)).toMatchObject({ ok: true });
	expect(await api.confirmWrite(move, describedMove.token)).toMatchObject({ ok: true });
	expect(writes().map((request) => [request.path, JSON.parse(request.body)])).toEqual([
		[
			"/rest/api/3/issue/APP-1/comment",
			{
				body: {
					type: "doc",
					version: 1,
					content: [
						{ type: "paragraph", content: [{ type: "text", text: "Started." }] },
						{ type: "paragraph", content: [{ type: "text", text: "PR soon." }] },
					],
				},
			},
		],
		["/rest/api/3/issue/APP-1/transitions", { transition: { id: "21" } }],
	]);
	expect(announced.map((entry) => entry.line)).toEqual([
		"You commented on APP-1: Started. PR soon.",
		"You moved APP-1: Start work (to In Progress).",
	]);
	const record = readFileSync(join(stateDir, "agent-world-outside-writes.jsonl"), "utf8").trim().split("\n");
	expect(record.map((line) => JSON.parse(line).kind)).toEqual(["jira-comment", "jira-transition"]);
});

test("the library searches every space and reads a page, which joins the recent list", async () => {
	const found = await api.confluenceSearch("quench");
	expect(found.ok && found.pages).toEqual([
		{
			id: "11",
			title: "Forge runbook",
			space: "Engineering",
			url: `${site.url}/wiki/spaces/ENG/pages/11/Forge+runbook`,
			excerpt: "how to quench a blade",
			lastModified: "2026-10-01T00:00:00.000Z",
		},
		{
			id: "22",
			title: "Smithing & you",
			space: "People",
			url: `${site.url}/wiki/spaces/HR/pages/22`,
			excerpt: "",
			lastModified: null,
		},
	]);
	const cql = site.seen
		.filter((request) => request.path === "/wiki/rest/api/search")
		.at(-1)!
		.query.get("cql");
	expect(cql).toBe('siteSearch ~ "quench" and type in (page, blogpost) order by lastmodified desc');

	expect(api.libraryRecent()).toEqual([]);
	const page = await api.confluencePage("11");
	expect(page.ok && page.page).toEqual({
		page: {
			id: "11",
			title: "Forge runbook",
			space: "Engineering",
			url: `${site.url}/wiki/spaces/ENG/pages/11/Forge+runbook`,
		},
		html: "<h1>Runbook</h1><p>Heat, then quench.</p>",
	});
	await api.confluencePage("22");
	await api.confluencePage("11");
	expect(api.libraryRecent().map((recent) => recent.id)).toEqual(["11", "22"]);
	expect(statSync(join(stateDir, "agent-world-library-recent.json")).mode & 0o777).toBe(0o600);
	// Agent World never writes to Confluence.
	expect(site.seen.filter((request) => request.path.startsWith("/wiki") && request.method !== "GET")).toEqual([]);
});

test("no credential reaches the renderer's answers or the logs; signing out deletes it", async () => {
	const answers = [
		api.credentialStatus(),
		await api.jiraAssigned(),
		await api.jiraIssue("APP-1"),
		await api.confluenceSearch("quench"),
		await api.outsideWrites(),
		api.libraryRecent(),
	];
	const text = JSON.stringify(answers);
	expect(text).not.toContain(TOKEN);
	expect(text).not.toContain(Buffer.from(`${EMAIL}:${TOKEN}`).toString("base64"));
	expect(JSON.stringify(logged)).not.toContain(TOKEN);
	expect(await api.signOutAtlassian()).toEqual({ ok: true });
	expect(existsSync(credentialsFile)).toBe(false);
	expect(api.credentialStatus().atlassian).toBeNull();
});
