// The forge's GitHub, through the `gh` CLI and its own sign-in (decision 07), always with JSON output. Lists open pull
// requests involving the operator (`gh search prs --involves @me`) and those of his awake agents' branches (`gh pr
// list --head`), rolls their checks up to one CI state, links each to the agent whose repository and branch it comes
// from, reads one with its diff for the review page, and sends reviews (`gh pr review`) for the outside-write gate.
// `gh` is found on PATH from the environment given, so tests put a fake first.
import { execFile } from "node:child_process";
import type {
	CiState,
	DiffFile,
	DiffHunk,
	Outcome,
	PullRequest,
	PullRequestDetail,
	Refusal,
} from "../../integrations.js";
import { DIFF_LINES_MAX } from "../../integrations.js";
import type { Character } from "../../world.js";

const TIMEOUT_MS = 30_000;
const LIST_MAX = 50;
/** `gh pr view` calls in flight at once while filling in searched pull requests. */
const PARALLEL = 4;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ROLLUP_FIELDS = "headRefName,statusCheckRollup,reviewDecision";
const LIST_FIELDS = `number,title,url,isDraft,updatedAt,author,${ROLLUP_FIELDS}`;

type Run = (args: string[], cwd?: string) => Promise<{ ok: true; stdout: string } | Refusal>;

function runner(env: NodeJS.ProcessEnv | undefined): Run {
	return (args, cwd) =>
		new Promise((resolve) => {
			execFile(
				"gh",
				args,
				{ cwd, env: env ?? process.env, timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 },
				(error, stdout, stderr) => {
					if (!error) return resolve({ ok: true, stdout });
					if ((error as NodeJS.ErrnoException).code === "ENOENT")
						return resolve({ ok: false, reason: "The GitHub CLI (gh) is not installed.", signIn: "github" });
					const said = String(stderr).trim();
					if (/gh auth login|not logged in|authentication/i.test(said))
						return resolve({ ok: false, reason: "Sign in to GitHub with `gh auth login` first.", signIn: "github" });
					resolve({ ok: false, reason: said.split("\n").slice(-3).join(" ") || error.message });
				},
			);
		});
}

const parse = <T>(text: string): T | undefined => {
	try {
		return JSON.parse(text) as T;
	} catch {
		return undefined;
	}
};

type CheckState = "passing" | "failing" | "running" | "skipped";

/** One entry of `statusCheckRollup`: a check run (status and conclusion) or a commit status (state). */
export function checkState(check: unknown): CheckState {
	const { status, conclusion, state } = (check ?? {}) as Record<string, unknown>;
	if (typeof state === "string") {
		if (state === "SUCCESS") return "passing";
		if (state === "FAILURE" || state === "ERROR") return "failing";
		return "running"; // PENDING, EXPECTED
	}
	if (status !== "COMPLETED") return "running";
	switch (conclusion) {
		case "SUCCESS":
			return "passing";
		case "NEUTRAL":
		case "SKIPPED":
		case "STALE":
			return "skipped";
		default:
			return "failing"; // FAILURE, TIMED_OUT, CANCELLED, ACTION_REQUIRED, STARTUP_FAILURE
	}
}

/** A pull request's checks rolled up: any failed is failing, else any unfinished is running, else passing. */
export function ciRollup(rollup: unknown): { ci: CiState; checks: PullRequest["checks"] } {
	const states = (Array.isArray(rollup) ? rollup : []).map(checkState);
	const count = (state: CheckState) => states.filter((one) => one === state).length;
	const checks = {
		passing: count("passing"),
		failing: count("failing"),
		running: count("running"),
		total: states.length,
	};
	const ci: CiState = checks.failing ? "failing" : checks.running ? "running" : states.length ? "passing" : "none";
	return { ci, checks };
}

export interface AgentBranch {
	id: string;
	name: string;
	/** `owner/name` of its repository on GitHub. */
	repo: string;
	branch: string;
}

/** Link each pull request to the agent whose repository and branch it comes from (repository names ignore case). */
export function linkPullRequests<T extends { repo: string; branch: string | null }>(
	pullRequests: T[],
	agents: AgentBranch[],
): (T & { agent: { id: string; name: string } | null })[] {
	return pullRequests.map((pr) => {
		const agent = agents.find((one) => one.branch === pr.branch && one.repo.toLowerCase() === pr.repo.toLowerCase());
		return { ...pr, agent: agent ? { id: agent.id, name: agent.name } : null };
	});
}

const unquote = (path: string) => path.replace(/^"(.*)"$/, "$1");

/** Read one line of a file's extended header (before its first hunk) into `file`. */
function fileHeader(file: DiffFile, line: string) {
	if (line.startsWith("new file mode")) file.status = "added";
	else if (line.startsWith("deleted file mode")) file.status = "deleted";
	else if (line.startsWith("rename from ")) {
		file.oldPath = line.slice("rename from ".length);
		file.status = "renamed";
	} else if (line.startsWith("rename to ")) file.path = line.slice("rename to ".length);
	else if (line.startsWith("Binary files ")) file.binary = true;
	else if (line.startsWith("--- ") && line !== "--- /dev/null")
		file.oldPath = unquote(line.slice(4).replace(/^a\//, ""));
	else if (line.startsWith("+++ ") && line !== "+++ /dev/null") file.path = unquote(line.slice(4).replace(/^b\//, ""));
}

/** A unified diff (`gh pr diff`) as files and hunks with line numbers on both sides; cut after `max` lines. */
export function parseDiff(patch: string, max = DIFF_LINES_MAX): { files: DiffFile[]; cut: boolean } {
	const files: DiffFile[] = [];
	let file: DiffFile | undefined;
	let hunk: DiffHunk | undefined;
	let oldLine = 0;
	let newLine = 0;
	let lines = 0;
	let cut = false;
	for (const line of patch.split("\n")) {
		if (line.startsWith("diff --git ")) {
			const paths = /^diff --git a\/(.*) b\/(.*)$/.exec(line);
			const path = unquote(paths?.[2] ?? "");
			file = {
				path,
				oldPath: unquote(paths?.[1] ?? path),
				status: "modified",
				binary: false,
				additions: 0,
				deletions: 0,
				hunks: [],
			};
			files.push(file);
			hunk = undefined;
			continue;
		}
		if (!file) continue;
		if (!hunk) fileHeader(file, line);
		const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
		if (header) {
			oldLine = Number(header[1]);
			newLine = Number(header[2]);
			hunk = { header: line, lines: [] };
			file.hunks.push(hunk);
			continue;
		}
		if (!hunk || line.startsWith("\\")) continue;
		const mark = line[0];
		if (mark !== "+" && mark !== "-" && mark !== " ") continue;
		if (mark === "+") file.additions++;
		if (mark === "-") file.deletions++;
		if (lines >= max) {
			cut = true;
			continue;
		}
		lines++;
		const text = line.slice(1);
		if (mark === "+") hunk.lines.push({ kind: "add", old: null, new: newLine++, text });
		else if (mark === "-") hunk.lines.push({ kind: "del", old: oldLine++, new: null, text });
		else hunk.lines.push({ kind: "context", old: oldLine++, new: newLine++, text });
	}
	return { files, cut };
}

/** The `owner/name` in a pull request's address. */
const repoOf = (url: string) => /github\.com\/([^/]+\/[^/]+)\/pull\//.exec(url)?.[1] ?? "";

type RawPr = {
	number: number;
	title?: string;
	url: string;
	isDraft?: boolean;
	updatedAt?: string;
	author?: { login?: string } | null;
	headRefName?: string;
	statusCheckRollup?: unknown;
	reviewDecision?: string | null;
	repository?: { nameWithOwner?: string };
};

function toPullRequest(raw: RawPr, involvesYou: boolean): Omit<PullRequest, "agent"> {
	const { ci, checks } = ciRollup(raw.statusCheckRollup);
	return {
		repo: raw.repository?.nameWithOwner ?? repoOf(raw.url),
		number: raw.number,
		title: raw.title ?? "",
		url: raw.url,
		author: raw.author?.login ?? null,
		draft: raw.isDraft === true,
		branch: raw.headRefName ?? null,
		updatedAt: raw.updatedAt ?? null,
		ci,
		checks,
		reviewDecision: raw.reviewDecision || null,
		involvesYou,
	};
}

export type ReviewEvent = "comment" | "approve" | "request-changes";

export interface GitHub {
	pullRequests(characters: Character[]): Promise<Outcome<{ pullRequests: PullRequest[] }>>;
	pullRequest(repo: string, number: number, characters: Character[]): Promise<Outcome<{ detail: PullRequestDetail }>>;
	/** A write: only the gate calls it. */
	review(repo: string, number: number, event: ReviewEvent, body: string): Promise<Outcome<object>>;
}

export function validPullRequest(repo: unknown, number: unknown): boolean {
	return typeof repo === "string" && REPO.test(repo) && Number.isSafeInteger(number) && (number as number) > 0;
}

export function openGitHub(env?: NodeJS.ProcessEnv): GitHub {
	const gh = runner(env);
	// Each repository directory's GitHub name and default branch; kept for the app's life (a remote rarely moves).
	const repos = new Map<string, Promise<{ repo: string; defaultBranch: string | null } | undefined>>();
	const repoAt = (directory: string) => {
		let known = repos.get(directory);
		if (!known) {
			known = gh(["repo", "view", "--json", "nameWithOwner,defaultBranchRef"], directory).then((answer) => {
				if (!answer.ok) {
					repos.delete(directory); // try again next time: gh may have been signed out
					return undefined;
				}
				const value = parse<{ nameWithOwner?: string; defaultBranchRef?: { name?: string } }>(answer.stdout);
				return value?.nameWithOwner
					? { repo: value.nameWithOwner, defaultBranch: value.defaultBranchRef?.name ?? null }
					: undefined;
			});
			repos.set(directory, known);
		}
		return known;
	};

	/** The awake agents on a branch of a GitHub repository other than its default branch. */
	const agentBranches = async (characters: Character[]): Promise<AgentBranch[]> => {
		const found = await Promise.all(
			characters.map(async (character): Promise<AgentBranch | undefined> => {
				const git = character.facts?.git;
				if (!git?.branch || git.branch === "HEAD") return undefined;
				const repo = await repoAt(git.repository);
				if (!repo || git.branch === repo.defaultBranch) return undefined;
				return { id: character.id, name: character.name, repo: repo.repo, branch: git.branch };
			}),
		);
		return found.filter((agent): agent is AgentBranch => agent !== undefined);
	};

	/** Run `work` over `items`, `PARALLEL` at a time. */
	const inParallel = async <T, R>(items: T[], work: (item: T) => Promise<R>): Promise<R[]> => {
		const results: R[] = new Array(items.length);
		let next = 0;
		await Promise.all(
			Array.from({ length: Math.min(PARALLEL, items.length) }, async () => {
				while (next < items.length) {
					const index = next++;
					results[index] = await work(items[index]);
				}
			}),
		);
		return results;
	};

	return {
		async pullRequests(characters) {
			const [searched, agents] = await Promise.all([
				gh([
					"search",
					"prs",
					"--involves",
					"@me",
					"--state",
					"open",
					"--limit",
					String(LIST_MAX),
					"--json",
					"number,title,url,repository,author,isDraft,updatedAt",
				]),
				agentBranches(characters),
			]);
			if (!searched.ok) return searched;
			// The agents' branches: one list per repository and branch.
			const branchKeys = [...new Map(agents.map((agent) => [`${agent.repo}\n${agent.branch}`, agent])).values()];
			const fromBranches = (
				await inParallel(branchKeys, (agent) =>
					gh(["pr", "list", "-R", agent.repo, "--head", agent.branch, "--state", "open", "--json", LIST_FIELDS]),
				)
			).flatMap((answer) => (answer.ok ? (parse<RawPr[]>(answer.stdout) ?? []) : []));
			const mine = parse<RawPr[]>(searched.stdout) ?? [];
			const byUrl = new Map(fromBranches.map((raw) => [raw.url, raw]));
			// Search results carry no branch or checks; read those for each one not already listed by branch.
			const filled = await inParallel(mine, async (raw): Promise<RawPr> => {
				const listed = byUrl.get(raw.url);
				if (listed) return { ...listed, ...raw, headRefName: listed.headRefName };
				const repo = raw.repository?.nameWithOwner ?? repoOf(raw.url);
				const answer = await gh(["pr", "view", String(raw.number), "-R", repo, "--json", ROLLUP_FIELDS]);
				return answer.ok ? { ...raw, ...parse<RawPr>(answer.stdout) } : raw;
			});
			const mineUrls = new Set(mine.map((raw) => raw.url));
			const all = [
				...filled.map((raw) => toPullRequest(raw, true)),
				...fromBranches.filter((raw) => !mineUrls.has(raw.url)).map((raw) => toPullRequest(raw, false)),
			];
			const unique = [...new Map(all.map((pr) => [pr.url, pr])).values()];
			unique.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
			return { ok: true, pullRequests: linkPullRequests(unique, agents) };
		},

		async pullRequest(repo, number, characters) {
			if (!validPullRequest(repo, number)) return { ok: false, reason: "That is not a pull request." };
			const [viewed, diffed, agents] = await Promise.all([
				gh([
					"pr",
					"view",
					String(number),
					"-R",
					repo,
					"--json",
					`number,title,body,url,author,isDraft,state,updatedAt,baseRefName,${ROLLUP_FIELDS}`,
				]),
				gh(["pr", "diff", String(number), "-R", repo]),
				agentBranches(characters),
			]);
			if (!viewed.ok) return viewed;
			if (!diffed.ok) return diffed;
			const raw = parse<RawPr & { body?: string; state?: string; baseRefName?: string }>(viewed.stdout);
			if (!raw) return { ok: false, reason: "gh answered something that is not JSON." };
			const [pullRequest] = linkPullRequests(
				[toPullRequest({ ...raw, repository: { nameWithOwner: repo } }, false)],
				agents,
			);
			const { files, cut } = parseDiff(diffed.stdout);
			const checks = (Array.isArray(raw.statusCheckRollup) ? raw.statusCheckRollup : []).map((check) => {
				const named = check as { name?: string; context?: string };
				return { name: named.name ?? named.context ?? "check", state: checkState(check) };
			});
			return {
				ok: true,
				detail: {
					pullRequest,
					body: raw.body ?? "",
					baseBranch: raw.baseRefName ?? null,
					state: raw.state ?? "OPEN",
					checks,
					files,
					cut,
				},
			};
		},

		async review(repo, number, event, body) {
			if (!validPullRequest(repo, number)) return { ok: false, reason: "That is not a pull request." };
			const flag = event === "approve" ? "--approve" : event === "comment" ? "--comment" : "--request-changes";
			const args = ["pr", "review", String(number), "-R", repo, flag, ...(body ? ["--body", body] : [])];
			const answer = await gh(args);
			return answer.ok ? { ok: true } : answer;
		},
	};
}
