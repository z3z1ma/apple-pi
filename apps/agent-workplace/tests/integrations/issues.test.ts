import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, expect, test } from "vitest";
import { googleStatus } from "../../src/backend/integrations/google.js";
import { openIntegrations } from "../../src/backend/integrations/index.js";
import { fakeGh } from "./fakes.js";

const stateDir = mkdtempSync(join(tmpdir(), "wp-issues-state-"));
const cli = fakeGh();
copyFileSync(join(cli.dir, "gh"), join(cli.dir, "gws"));
const api = openIntegrations({
	stateDir,
	snapshot: () => ({ connected: true, headquarters: [], characters: [] }),
	commands: { send: async () => ({ ok: false, reason: "No runtime in this test" }), close() {} },
	env: cli.env,
});
afterAll(() => {
	api.close();
	rmSync(stateDir, { recursive: true, force: true });
	rmSync(cli.dir, { recursive: true, force: true });
});
beforeEach(() => cli.rules([]));

const raw = {
	number: 7,
	title: "Fix keyboard navigation",
	url: "https://github.com/acme/app/issues/7",
	state: "open",
	repository: { nameWithOwner: "acme/app" },
	assignees: [{ login: "operator" }],
	updatedAt: "2026-11-03T10:00:00Z",
};

test("GitHub assigned reads open operator issues without relying on a local repository", async () => {
	cli.rules([{ args: ["search", "issues", "--assignee", "@me", "--state", "open"], stdout: [raw] }]);
	const answer = await api.githubAssigned();
	expect(answer).toMatchObject({
		ok: true,
		issues: [
			{
				key: "acme/app#7",
				summary: raw.title,
				url: raw.url,
				project: "acme/app",
				assignee: "operator",
				status: "Open",
				statusCategory: "new",
			},
		],
	});
});

test("GitHub search keeps text as one positional query, includes closed issues and does not add an assignee", async () => {
	const query = "--assignee someone else";
	cli.rules([{ args: ["search", "issues", "--", query], stdout: [{ ...raw, state: "closed", assignees: [] }] }]);
	const before = cli.calls().length;
	expect(await api.githubSearch(` ${query} `)).toMatchObject({
		ok: true,
		issues: [{ status: "Closed", statusCategory: "done", assignee: null }],
	});
	const args = cli.calls()[before].args;
	expect(args.slice(-2)).toEqual(["--", query]);
	expect(args).not.toContain("@me");
	expect(args).not.toContain("--state");
});

test("GitHub detail reads the selected repository/number and keeps outside markup as plain text", async () => {
	cli.rules([
		{
			args: ["issue", "view", "7", "-R", "acme/app"],
			stdout: {
				...raw,
				author: { login: "reporter" },
				body: "<script>outside()</script>",
				createdAt: "2026-11-01T00:00:00Z",
				comments: [{ id: "IC_1", author: null, createdAt: "2026-11-02T00:00:00Z", body: "<img src=remote>" }],
			},
		},
	]);
	expect(await api.githubIssue("acme/app#7")).toMatchObject({
		ok: true,
		detail: {
			issue: { key: "acme/app#7", summary: raw.title },
			reporter: "reporter",
			descriptionHtml: null,
			descriptionText: "<script>outside()</script>",
			comments: [{ id: "IC_1", author: null, html: null, text: "<img src=remote>" }],
		},
	});
});

test("a full GitHub issue key searches by its repository and number rather than ambiguous text", async () => {
	cli.rules([{ args: ["issue", "view", "7", "-R", "acme/app"], stdout: raw }]);
	const before = cli.calls().length;
	expect(await api.githubSearch(" acme/app#7 ")).toMatchObject({
		ok: true,
		issues: [{ key: "acme/app#7", url: raw.url }],
	});
	expect(
		cli
			.calls()
			.slice(before)
			.map((call) => call.args.slice(0, 5)),
	).toEqual([["issue", "view", "7", "-R", "acme/app"]]);
});

test("bad issue keys and empty searches make no gh call", async () => {
	const before = cli.calls().length;
	for (const key of [
		"--repo=other",
		"acme/app#0",
		"acme/app#9007199254740992",
		"https://github.com/acme/app/issues/7",
		null,
	])
		expect(await api.githubIssue(key)).toMatchObject({ ok: false });
	expect(await api.githubSearch("  ")).toEqual({ ok: true, issues: [] });
	expect(cli.calls().length).toBe(before);
});

test("GitHub read failures remain visible and malformed JSON is not an empty successful list", async () => {
	cli.rules([{ args: ["search", "issues"], code: 1, stderr: "Please run gh auth login" }]);
	expect(await api.githubAssigned()).toMatchObject({ ok: false, signIn: "github" });
	cli.rules([{ args: ["search", "issues"], stdout: "not JSON" }]);
	expect(await api.githubAssigned()).toMatchObject({ ok: false });
});

test("GitHub status verifies the active github.com account, exposing only its login", async () => {
	cli.rules([
		{ args: ["auth", "status", "--active", "--hostname", "github.com"], stdout: "private CLI diagnostics" },
		{ args: ["api", "user", "--hostname", "github.com", "--jq", ".login"], stdout: "operator\n" },
	]);
	expect(await api.githubStatus()).toEqual({ ok: true, account: "operator" });
});

test("GitHub signed-out status reports sign-in instructions without trying to change accounts", async () => {
	cli.rules([{ args: ["auth", "status"], code: 1, stderr: "not logged in; gh auth login" }]);
	const before = cli.calls().length;
	expect(await api.githubStatus()).toMatchObject({
		ok: false,
		signIn: "github",
		reason: expect.stringContaining("gh auth login"),
	});
	expect(cli.calls().length - before).toBe(1);
});

test("Google status projects only the CLI's account, not tokens, paths or diagnostic fields", async () => {
	cli.rules([
		{
			args: ["auth", "status"],
			stdout: {
				user: "operator@example.test",
				auth_method: "oauth2",
				token_valid: true,
				client_id: "private-id",
				client_secret: "private-secret",
				encrypted_credentials: "/private/path",
			},
		},
	]);
	expect(await api.googleStatus()).toEqual({ ok: true, account: "operator@example.test" });
});

test("Google signed out and missing CLI are distinct from signed in", async () => {
	cli.rules([{ args: ["auth", "status"], stdout: { auth_method: "none", storage: "none" } }]);
	expect(await api.googleStatus()).toEqual({ ok: true, account: null });
	expect(await googleStatus({ PATH: stateDir })).toMatchObject({
		ok: false,
		reason: expect.stringContaining("not installed"),
	});
});

test("Google failures and malformed status stay failures without forwarding diagnostic output", async () => {
	cli.rules([{ args: ["auth", "status"], code: 1, stderr: "private-secret" }]);
	const failure = await api.googleStatus();
	expect(failure.ok).toBe(false);
	expect(JSON.stringify(failure)).not.toContain("private-secret");
	cli.rules([{ args: ["auth", "status"], stdout: "not JSON" }]);
	expect(await api.googleStatus()).toMatchObject({ ok: false });
});
