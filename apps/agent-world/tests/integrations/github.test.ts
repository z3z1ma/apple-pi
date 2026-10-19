import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, expect, test } from "vitest";
import { ciRollup, linkPullRequests, parseDiff } from "../../src/backend/integrations/github.js";
import { openIntegrations } from "../../src/backend/integrations/index.js";
import type { OutsideWriteEntry } from "../../src/integrations.js";
import type { Character, WorldSnapshot } from "../../src/world.js";
import { fakeGh } from "./fakes.js";

// Seam 1 for the forge: the backend API in Node against a fake `gh` on PATH.
const stateDir = mkdtempSync(join(tmpdir(), "aw-forge-state-"));
const repoApp = mkdtempSync(join(tmpdir(), "aw-forge-app-"));
const gh = fakeGh();

const agent = (id: string, name: string, repository: string, branch: string, run = "idle"): Character => ({
	id,
	name,
	role: "worker",
	place: { kind: "wing", headquarters: "hq", repository },
	startedAt: 1,
	facts: { run, git: { repository, worktree: repository, branch } } as Character["facts"],
});
let world: WorldSnapshot = { connected: true, headquarters: [], characters: [] };
const announced: OutsideWriteEntry[] = [];
const api = openIntegrations({
	stateDir,
	snapshot: () => world,
	commands: { send: async () => ({ ok: false, reason: "no runtime in this test" }), close() {} },
	env: gh.env,
});
api.onOutsideWrite((entry) => announced.push(entry));
afterAll(() => {
	api.close();
	for (const dir of [stateDir, repoApp, gh.dir]) rmSync(dir, { recursive: true, force: true });
});

const passing = { __typename: "CheckRun", name: "lint", status: "COMPLETED", conclusion: "SUCCESS" };
const failing = { __typename: "CheckRun", name: "test", status: "COMPLETED", conclusion: "FAILURE" };
const running = { __typename: "CheckRun", name: "build", status: "IN_PROGRESS", conclusion: "" };
const pendingStatus = { __typename: "StatusContext", context: "ci/legacy", state: "PENDING" };

const RULES = [
	{ args: ["repo", "view"], cwd: repoApp, stdout: { nameWithOwner: "acme/app", defaultBranchRef: { name: "main" } } },
	{
		args: ["search", "prs", "--involves", "@me", "--state", "open"],
		stdout: [
			{
				number: 7,
				title: "Fix the docs",
				url: "https://github.com/acme/docs/pull/7",
				repository: { name: "docs", nameWithOwner: "acme/docs" },
				author: { login: "operator" },
				isDraft: false,
				updatedAt: "2026-10-18T09:00:00Z",
			},
			{
				number: 12,
				title: "Add the forge",
				url: "https://github.com/acme/app/pull/12",
				repository: { name: "app", nameWithOwner: "acme/app" },
				author: { login: "operator" },
				isDraft: false,
				updatedAt: "2026-10-18T10:00:00Z",
			},
		],
	},
	{
		args: ["pr", "view", "7", "-R", "acme/docs"],
		stdout: { headRefName: "docs-fix", statusCheckRollup: [passing, failing, running], reviewDecision: null },
	},
	{
		args: ["pr", "view", "12", "-R", "acme/app", "--json"],
		stdout: { headRefName: "feat-forge", statusCheckRollup: [passing, running], reviewDecision: "REVIEW_REQUIRED" },
	},
	{
		args: ["pr", "list", "-R", "acme/app", "--head", "feat-forge"],
		stdout: [
			{
				number: 12,
				title: "Add the forge",
				url: "https://github.com/acme/app/pull/12",
				headRefName: "feat-forge",
				isDraft: false,
				updatedAt: "2026-10-18T10:00:00Z",
				author: { login: "operator" },
				statusCheckRollup: [passing, running],
				reviewDecision: "REVIEW_REQUIRED",
			},
		],
	},
	{
		args: ["pr", "list", "-R", "acme/app", "--head", "feat-quench"],
		stdout: [
			{
				number: 13,
				title: "Quench the blade",
				url: "https://github.com/acme/app/pull/13",
				headRefName: "feat-quench",
				isDraft: true,
				updatedAt: "2026-10-17T10:00:00Z",
				author: { login: "bot-builder" },
				statusCheckRollup: [passing, { __typename: "StatusContext", context: "ci", state: "SUCCESS" }],
				reviewDecision: null,
			},
		],
	},
];

beforeEach(() => {
	gh.rules(RULES);
	world = {
		connected: true,
		headquarters: [],
		characters: [
			agent("s-forge", "Ada", repoApp, "feat-forge"),
			agent("s-quench", "Bo", repoApp, "feat-quench"),
			agent("s-main", "Cy", repoApp, "main"),
		],
	};
});

test("CI rolls up to failing, running, passing, or none", () => {
	expect(ciRollup([passing, failing, running]).ci).toBe("failing");
	expect(ciRollup([passing, running]).ci).toBe("running");
	expect(ciRollup([passing, pendingStatus]).ci).toBe("running");
	expect(ciRollup([passing, { __typename: "StatusContext", state: "ERROR" }]).ci).toBe("failing");
	expect(ciRollup([passing, { __typename: "CheckRun", status: "COMPLETED", conclusion: "SKIPPED" }])).toMatchObject({
		ci: "passing",
		checks: { passing: 1, failing: 0, running: 0, total: 2 },
	});
	expect(ciRollup([]).ci).toBe("none");
	expect(ciRollup(null).ci).toBe("none");
});

test("a pull request links to the agent whose repository and branch match", () => {
	const prs = [
		{ repo: "acme/app", branch: "feat-forge" },
		{ repo: "acme/app", branch: "other" },
		{ repo: "acme/docs", branch: "feat-forge" },
	];
	const linked = linkPullRequests(prs, [{ id: "s1", name: "Ada", repo: "ACME/app", branch: "feat-forge" }]);
	expect(linked.map((pr) => pr.agent)).toEqual([{ id: "s1", name: "Ada" }, null, null]);
});

test("the forge lists the operator's and his agents' open pull requests with CI, linked by branch", async () => {
	const listed = await api.pullRequests();
	expect(listed.ok).toBe(true);
	if (!listed.ok) return;
	expect(
		listed.pullRequests.map((pr) => ({
			ref: `${pr.repo}#${pr.number}`,
			ci: pr.ci,
			agent: pr.agent?.name ?? null,
			you: pr.involvesYou,
			branch: pr.branch,
		})),
	).toEqual([
		{ ref: "acme/app#12", ci: "running", agent: "Ada", you: true, branch: "feat-forge" },
		{ ref: "acme/docs#7", ci: "failing", agent: null, you: true, branch: "docs-fix" },
		{ ref: "acme/app#13", ci: "passing", agent: "Bo", you: false, branch: "feat-quench" },
	]);
	expect(listed.pullRequests[0]).toMatchObject({
		title: "Add the forge",
		url: "https://github.com/acme/app/pull/12",
		reviewDecision: "REVIEW_REQUIRED",
		checks: { passing: 1, running: 1, failing: 0, total: 2 },
	});
	expect(listed.pullRequests[2].draft).toBe(true);
	// The default branch is nobody's pull request; it is not looked up.
	expect(gh.calls().some((call) => call.args.includes("--head") && call.args.includes("main"))).toBe(false);
});

test("without gh signed in, the forge says so", async () => {
	gh.rules([
		{ args: ["search"], stderr: "To get started with GitHub CLI, please run:  gh auth login\n", code: 4 },
		{ args: ["repo", "view"], stderr: "gh auth login\n", code: 4 },
	]);
	const listed = await api.pullRequests();
	expect(listed).toMatchObject({ ok: false, signIn: "github" });
});

const PATCH = `diff --git a/src/forge.ts b/src/forge.ts
index 1111111..2222222 100644
--- a/src/forge.ts
+++ b/src/forge.ts
@@ -10,4 +10,5 @@ export function heat() {
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 return a;
\\ No newline at end of file
diff --git a/old name.md b/new name.md
similarity index 90%
rename from old name.md
rename to new name.md
index 3333333..4444444 100644
--- a/old name.md
+++ b/new name.md
@@ -1 +1 @@
-old
+new
diff --git a/logo.png b/logo.png
new file mode 100644
index 0000000..5555555
Binary files /dev/null and b/logo.png differ
diff --git a/gone.txt b/gone.txt
deleted file mode 100644
index 6666666..0000000
--- a/gone.txt
+++ /dev/null
@@ -1,2 +0,0 @@
-one
-two
`;

test("a diff parses into files and hunks with old and new line numbers", () => {
	const { files, cut } = parseDiff(PATCH);
	expect(cut).toBe(false);
	expect(
		files.map((file) => [file.path, file.oldPath, file.status, file.binary, file.additions, file.deletions]),
	).toEqual([
		["src/forge.ts", "src/forge.ts", "modified", false, 2, 1],
		["new name.md", "old name.md", "renamed", false, 1, 1],
		["logo.png", "logo.png", "added", true, 0, 0],
		["gone.txt", "gone.txt", "deleted", false, 0, 2],
	]);
	expect(files[0].hunks[0].header).toBe("@@ -10,4 +10,5 @@ export function heat() {");
	expect(files[0].hunks[0].lines).toEqual([
		{ kind: "context", old: 10, new: 10, text: "const a = 1;" },
		{ kind: "del", old: 11, new: null, text: "const b = 2;" },
		{ kind: "add", old: null, new: 11, text: "const b = 3;" },
		{ kind: "add", old: null, new: 12, text: "const c = 4;" },
		{ kind: "context", old: 12, new: 13, text: "return a;" },
	]);
	expect(parseDiff(PATCH, 3).cut).toBe(true);
});

test("the review page reads a pull request with its checks and diff", async () => {
	gh.rules([
		...RULES,
		{
			args: ["pr", "view", "12", "-R", "acme/app", "--json"],
			stdout: {
				number: 12,
				title: "Add the forge",
				body: "Adds the forge.",
				url: "https://github.com/acme/app/pull/12",
				author: { login: "operator" },
				headRefName: "feat-forge",
				baseRefName: "main",
				isDraft: false,
				state: "OPEN",
				updatedAt: "2026-10-18T10:00:00Z",
				reviewDecision: "REVIEW_REQUIRED",
				statusCheckRollup: [passing, running],
			},
		},
		{ args: ["pr", "diff", "12", "-R", "acme/app"], stdout: PATCH },
	]);
	const read = await api.pullRequest("acme/app", 12);
	expect(read.ok).toBe(true);
	if (!read.ok) return;
	expect(read.detail).toMatchObject({
		body: "Adds the forge.",
		baseBranch: "main",
		state: "OPEN",
		checks: [
			{ name: "lint", state: "passing" },
			{ name: "build", state: "running" },
		],
		pullRequest: { repo: "acme/app", number: 12, ci: "running", agent: { id: "s-forge", name: "Ada" } },
	});
	expect(read.detail.files.map((file) => file.path)).toEqual(["src/forge.ts", "new name.md", "logo.png", "gone.txt"]);
	expect(await api.pullRequest("acme/app; rm -rf /", 12)).toMatchObject({ ok: false });
});

const reviewCalls = () => gh.calls().filter((call) => call.args[0] === "pr" && call.args[1] === "review");
const recordLines = () => {
	try {
		return readFileSync(join(stateDir, "agent-world-outside-writes.jsonl"), "utf8").split("\n").filter(Boolean);
	} catch {
		return [];
	}
};

test("a review is sent through gh only with the confirmation for that exact review, then recorded and announced", async () => {
	gh.rules([...RULES, { args: ["pr", "review"], stdout: "" }]);
	const approve = { kind: "github-review", repo: "acme/app", number: 12, event: "approve", body: "" } as const;
	const described = await api.describeWrite(approve);
	expect(described).toMatchObject({
		ok: true,
		description: {
			what: "Approve pull request",
			where: "acme/app#12 on GitHub",
			text: "",
			url: "https://github.com/acme/app/pull/12",
		},
	});
	if (!described.ok) return;
	const before = recordLines().length;

	// Declined (never confirmed), a made-up token, or the token of another write: nothing is sent.
	expect(await api.confirmWrite(approve, "not-a-token")).toMatchObject({ ok: false });
	const other = { ...approve, event: "request-changes", body: "Please split it." } as const;
	expect(await api.confirmWrite(other, described.token)).toMatchObject({ ok: false });
	expect(reviewCalls()).toEqual([]);
	expect(recordLines().length).toBe(before);

	const sent = await api.confirmWrite(approve, described.token);
	expect(sent).toMatchObject({
		ok: true,
		entry: { ok: true, what: "Approve pull request", line: "You approved acme/app#12." },
	});
	expect(reviewCalls().map((call) => call.args)).toEqual([["pr", "review", "12", "-R", "acme/app", "--approve"]]);
	const lines = recordLines();
	expect(lines.length).toBe(before + 1);
	expect(JSON.parse(lines.at(-1)!)).toMatchObject({ kind: "github-review", where: "acme/app#12 on GitHub", ok: true });
	expect(statSync(join(stateDir, "agent-world-outside-writes.jsonl")).mode & 0o777).toBe(0o600);
	expect(announced.at(-1)?.line).toBe("You approved acme/app#12.");
	expect((await api.outsideWrites()).at(-1)?.line).toBe("You approved acme/app#12.");

	// A token is good once.
	expect(await api.confirmWrite(approve, described.token)).toMatchObject({ ok: false });
	expect(reviewCalls().length).toBe(1);
});

test("a comment and a change request carry their exact text; a change request without text is refused", async () => {
	gh.rules([...RULES, { args: ["pr", "review"], stdout: "" }]);
	expect(
		await api.describeWrite({
			kind: "github-review",
			repo: "acme/app",
			number: 12,
			event: "request-changes",
			body: " ",
		}),
	).toMatchObject({ ok: false });
	const comment = {
		kind: "github-review",
		repo: "acme/app",
		number: 12,
		event: "comment",
		body: "Looks close.\nOne nit.",
	} as const;
	const described = await api.describeWrite(comment);
	expect(described).toMatchObject({
		ok: true,
		description: { what: "Comment on pull request", text: "Looks close.\nOne nit." },
	});
	if (!described.ok) return;
	await api.confirmWrite(comment, described.token);
	expect(reviewCalls().at(-1)?.args).toEqual([
		"pr",
		"review",
		"12",
		"-R",
		"acme/app",
		"--comment",
		"--body",
		"Looks close.\nOne nit.",
	]);
	expect(announced.at(-1)?.line).toBe("You commented on acme/app#12: Looks close. One nit.");
});

test("a failed review is recorded and announced as failed", async () => {
	gh.rules([...RULES, { args: ["pr", "review"], stderr: "GraphQL: Can not approve your own pull request\n", code: 1 }]);
	const approve = { kind: "github-review", repo: "acme/app", number: 12, event: "approve", body: "" } as const;
	const described = await api.describeWrite(approve);
	if (!described.ok) throw new Error(described.reason);
	const sent = await api.confirmWrite(approve, described.token);
	expect(sent).toMatchObject({ ok: false, reason: expect.stringContaining("Can not approve your own pull request") });
	expect(JSON.parse(recordLines().at(-1)!)).toMatchObject({ ok: false });
	expect(announced.at(-1)).toMatchObject({
		ok: false,
		line: expect.stringMatching(/^Your approval of acme\/app#12 failed/),
	});
});
