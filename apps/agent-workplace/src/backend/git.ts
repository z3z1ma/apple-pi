import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type {
	GitAction,
	GitApi,
	GitChange,
	GitCommit,
	GitCommitDetail,
	GitFileChange,
	GitOverview,
	GitRef,
	GitState,
} from "../git.js";
import { attempt, git, parseWorktrees, repositoryRoot, within } from "./workspace.js";

const FIELD = "\x1f";
const RECORD = "\x1e";
const COMMIT_FORMAT = ["%H", "%P", "%an", "%ae", "%at", "%s", "%D"].join("%x1f");

function relativePath(root: string, path: string) {
	if (!path || isAbsolute(path) || path.includes("\0")) throw new Error("Choose a relative file path.");
	within(root, resolve(root, path));
	return `:(literal)${path}`;
}

function revision(value: string) {
	if (!value || value.startsWith("-") || /[\s\0]/.test(value) || value.includes(".."))
		throw new Error(`Not a revision: ${JSON.stringify(value)}`);
	return value;
}

function branchName(value: string) {
	if (!value || value.startsWith("-") || /[\s\0~^:?*[\\]/.test(value) || value.includes(".."))
		throw new Error(`Not a valid name: ${JSON.stringify(value)}`);
	return value;
}

export function parseStatus(output: string): GitChange[] {
	const records = output.split("\0");
	const changes: GitChange[] = [];
	for (let i = 0; i < records.length; i++) {
		const record = records[i];
		if (!record) continue;
		const change: GitChange = { path: record.slice(3), index: record[0], worktree: record[1] };
		if (/[RC]/.test(record.slice(0, 2))) change.previousPath = records[++i];
		changes.push(change);
	}
	return changes;
}

function refsOf(decoration: string): string[] {
	return decoration
		.split(", ")
		.filter(Boolean)
		.map((ref) => ref.replace(/^HEAD -> /, "HEAD -> "));
}

export function parseLog(output: string): GitCommit[] {
	return output
		.split(RECORD)
		.map((record) => record.replace(/^\n/, ""))
		.filter(Boolean)
		.map((record) => {
			const [sha, parents, author, email, date, subject, decoration] = record.split(FIELD);
			return {
				sha,
				parents: parents ? parents.split(" ") : [],
				author,
				email,
				date: Number(date),
				subject,
				refs: refsOf(decoration ?? ""),
			};
		});
}

function parseTrack(track: string) {
	if (track === "gone") return { gone: true };
	const ahead = /ahead (\d+)/.exec(track)?.[1];
	const behind = /behind (\d+)/.exec(track)?.[1];
	return { ahead: Number(ahead ?? 0), behind: Number(behind ?? 0) };
}

export function parseRefs(output: string): GitRef[] {
	return output
		.split("\n")
		.filter(Boolean)
		.flatMap((line): GitRef[] => {
			const [full, target, upstream, track, head] = line.split(FIELD);
			const current = head === "*";
			if (full.startsWith("refs/heads/"))
				return [
					{
						name: full.slice("refs/heads/".length),
						kind: "local",
						target,
						current,
						...(upstream ? { upstream, ...parseTrack(track) } : {}),
					},
				];
			if (full.startsWith("refs/remotes/")) {
				const name = full.slice("refs/remotes/".length);
				if (name.endsWith("/HEAD")) return [];
				return [{ name, kind: "remote", target, current: false }];
			}
			if (full.startsWith("refs/tags/"))
				return [{ name: full.slice("refs/tags/".length), kind: "tag", target, current: false }];
			return [];
		});
}

function parseFiles(output: string): GitFileChange[] {
	const fields = output.split("\0").filter((field, index, all) => field || index < all.length - 1);
	const files: GitFileChange[] = [];
	for (let i = 0; i < fields.length; i++) {
		const status = fields[i];
		if (!status) continue;
		if (/^[RC]/.test(status)) {
			files.push({ status: status[0], previousPath: fields[i + 1], path: fields[i + 2] });
			i += 2;
		} else {
			files.push({ status: status[0], path: fields[i + 1] });
			i += 1;
		}
	}
	return files;
}

async function gitState(root: string): Promise<GitState> {
	const dir = (await git(root, ["rev-parse", "--absolute-git-dir"])).trim();
	if (existsSync(join(dir, "rebase-merge")) || existsSync(join(dir, "rebase-apply"))) return "rebasing";
	if (existsSync(join(dir, "MERGE_HEAD"))) return "merging";
	if (existsSync(join(dir, "CHERRY_PICK_HEAD"))) return "cherry-picking";
	if (existsSync(join(dir, "REVERT_HEAD"))) return "reverting";
	return "clean";
}

async function overview(root: string): Promise<GitOverview> {
	const [status, refsOutput, stashOutput, remotesOutput, worktreeOutput, state, head] = await Promise.all([
		git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
		git(root, [
			"for-each-ref",
			"--format=%(refname)%1f%(objectname)%1f%(upstream:short)%1f%(upstream:track,nobracket)%1f%(HEAD)",
			"refs/heads",
			"refs/remotes",
			"refs/tags",
		]),
		git(root, ["stash", "list", "--format=%gd%x1f%ct%x1f%gs"]),
		git(root, ["remote"]),
		git(root, ["worktree", "list", "--porcelain", "-z"]),
		gitState(root),
		git(root, ["rev-parse", "--verify", "--quiet", "HEAD"], { ok: [1] }),
	]);
	const refs = parseRefs(refsOutput);
	const current = refs.find((ref) => ref.kind === "local" && ref.current);
	return {
		root,
		branch: current?.name ?? null,
		head: head.trim() || null,
		upstream: current?.upstream ?? null,
		ahead: current?.ahead ?? 0,
		behind: current?.behind ?? 0,
		state,
		remotes: remotesOutput.split("\n").filter(Boolean),
		refs,
		stashes: stashOutput
			.split("\n")
			.filter(Boolean)
			.map((line) => {
				const [ref, date, message] = line.split(FIELD);
				return { index: Number(/\{(\d+)\}/.exec(ref)?.[1] ?? 0), date: Number(date), message };
			}),
		worktrees: parseWorktrees(worktreeOutput, root),
		changes: parseStatus(status),
	};
}

async function show(root: string, sha: string): Promise<GitCommitDetail> {
	const at = revision(sha);
	const meta = await git(root, ["show", "-s", `--format=${COMMIT_FORMAT}%x1f%B%x1f%cn%x1f%ct`, at, "--"]);
	const [commitSha, parents, author, email, date, subject, decoration, body, committer, committed] = meta.split(FIELD);
	const parentList = parents ? parents.split(" ") : [];
	const files = parseFiles(
		await git(root, [
			"diff-tree",
			"-r",
			"-z",
			"-M",
			"--name-status",
			"--no-commit-id",
			...(parentList.length ? [parentList[0], commitSha] : ["--root", commitSha]),
		]),
	);
	return {
		sha: commitSha,
		parents: parentList,
		author,
		email,
		date: Number(date),
		subject,
		refs: refsOf(decoration),
		body: body.trim(),
		committer,
		committed: Number(committed),
		files,
	};
}

async function pushArgs(root: string, force: boolean): Promise<string[]> {
	const info = await overview(root);
	if (!info.branch) throw new Error("Check out a branch before pushing.");
	const flags = force ? ["--force-with-lease"] : [];
	if (info.upstream) return ["push", ...flags];
	const remote = info.remotes.includes("origin") ? "origin" : info.remotes[0];
	if (!remote) throw new Error("This repository has no remote to push to.");
	return ["push", ...flags, "--set-upstream", remote, info.branch];
}

async function checkout(root: string, ref: string): Promise<string[]> {
	const info = await overview(root);
	const target = info.refs.find((each) => each.name === ref);
	if (target?.kind === "remote") {
		const local = ref.slice(ref.indexOf("/") + 1);
		if (info.refs.some((each) => each.kind === "local" && each.name === local)) return ["switch", branchName(local)];
		return ["switch", "--create", branchName(local), "--track", revision(ref)];
	}
	if (target?.kind === "local") return ["switch", branchName(ref)];
	return ["switch", "--detach", revision(ref)];
}

async function abortArgs(root: string, mode: "abort" | "continue"): Promise<string[]> {
	const state = await gitState(root);
	const command = {
		rebasing: "rebase",
		merging: "merge",
		"cherry-picking": "cherry-pick",
		reverting: "revert",
		clean: "",
	}[state];
	if (!command) throw new Error("No merge, rebase, cherry-pick or revert is in progress.");
	if (mode === "continue" && command === "merge") return ["commit", "--no-edit"];
	return [command, `--${mode}`];
}

async function untracked(root: string, paths: string[]) {
	const output = await git(root, [
		"ls-files",
		"--others",
		"--exclude-standard",
		"-z",
		"--",
		...paths.map((path) => relativePath(root, path)),
	]);
	return new Set(output.split("\0").filter(Boolean));
}

async function argumentsFor(root: string, action: GitAction): Promise<string[][]> {
	const pathspecs = (paths: string[]) => {
		if (!paths.length) throw new Error("Choose at least one file.");
		return paths.map((path) => relativePath(root, path));
	};
	switch (action.kind) {
		case "stage":
			return [["add", "--all", "--", ...pathspecs(action.paths)]];
		case "unstage":
			return (await git(root, ["rev-parse", "--verify", "--quiet", "HEAD"], { ok: [1] })).trim()
				? [["restore", "--staged", "--", ...pathspecs(action.paths)]]
				: [["rm", "--cached", "--quiet", "-r", "--", ...pathspecs(action.paths)]];
		case "discard": {
			const fresh = await untracked(root, action.paths);
			const tracked = action.paths.filter((path) => !fresh.has(path));
			return [
				...(tracked.length
					? [["restore", "--source=HEAD", "--staged", "--worktree", "--", ...pathspecs(tracked)]]
					: []),
				...(fresh.size ? [["clean", "--force", "--", ...pathspecs([...fresh])]] : []),
			];
		}
		case "commit":
			if (!action.message.trim() && !action.amend) throw new Error("Write a commit message.");
			return [
				["commit", ...(action.amend ? ["--amend"] : []), ...(action.message.trim() ? ["--file=-"] : ["--no-edit"])],
			];
		case "checkout":
			return [await checkout(root, action.ref)];
		case "checkoutCommit":
			return [["switch", "--detach", revision(action.sha)]];
		case "createBranch":
			return [
				action.checkout
					? ["switch", "--create", branchName(action.name), revision(action.from)]
					: ["branch", branchName(action.name), revision(action.from)],
			];
		case "deleteBranch":
			return [
				[
					"branch",
					action.force ? "--delete" : "--delete",
					...(action.force ? ["--force"] : []),
					branchName(action.name),
				],
			];
		case "merge":
			return [["merge", "--no-edit", revision(action.ref)]];
		case "rebase":
			return [["rebase", revision(action.onto)]];
		case "abort":
			return [await abortArgs(root, "abort")];
		case "continue":
			return [await abortArgs(root, "continue")];
		case "fetch":
			return [["fetch", "--all", "--prune", "--tags"]];
		case "pull":
			return [["pull", "--no-edit"]];
		case "push":
			return [await pushArgs(root, action.force)];
		case "stashSave":
			return [
				[
					"stash",
					"push",
					...(action.untracked ? ["--include-untracked"] : []),
					...(action.message.trim() ? ["--message", action.message.trim()] : []),
				],
			];
		case "stashApply":
			return [["stash", "apply", `stash@{${action.index}}`]];
		case "stashPop":
			return [["stash", "pop", `stash@{${action.index}}`]];
		case "stashDrop":
			return [["stash", "drop", `stash@{${action.index}}`]];
		case "cherryPick":
			return [["cherry-pick", revision(action.sha)]];
		case "revert":
			return [["revert", "--no-edit", revision(action.sha)]];
		case "reset":
			return [["reset", `--${action.mode}`, revision(action.sha)]];
		case "createTag":
			return [["tag", branchName(action.name), revision(action.sha)]];
		case "deleteTag":
			return [["tag", "--delete", branchName(action.name)]];
	}
}

export function openGit(): GitApi {
	return {
		overview: (request) => attempt(async () => ({ overview: await overview(await repositoryRoot(request.root)) })),
		log: (request) =>
			attempt(async () => {
				const root = await repositoryRoot(request.root);
				const head = (await git(root, ["rev-parse", "--verify", "--quiet", "HEAD"], { ok: [1] })).trim();
				const refs = (await git(root, ["for-each-ref", "--count=1", "--format=%(refname)", "refs"])).trim();
				if (!head && !refs) return { commits: [] };
				const output = await git(root, [
					"log",
					"--topo-order",
					"--branches",
					"--remotes",
					"--tags",
					...(head ? ["HEAD"] : []),
					`--format=${COMMIT_FORMAT}%x1e`,
					`--skip=${request.skip}`,
					`--max-count=${request.limit}`,
					"--",
				]);
				return { commits: parseLog(output) };
			}),
		show: (request) =>
			attempt(async () => {
				const root = await repositoryRoot(request.root);
				return { commit: await show(root, request.sha) };
			}),
		diff: (request) =>
			attempt(async () => {
				const root = await repositoryRoot(request.root);
				const path = relativePath(root, request.path);
				if ("commit" in request) {
					const commit = await show(root, request.commit);
					const base = commit.parents[0];
					return {
						text: await git(root, [
							"diff",
							"--no-ext-diff",
							"--no-textconv",
							"-M",
							...(base ? [base, commit.sha] : ["--root", commit.sha]),
							"--",
							path,
						]),
					};
				}
				const fresh = !request.staged && (await untracked(root, [request.path])).size > 0;
				return {
					text: fresh
						? await git(
								root,
								["diff", "--no-ext-diff", "--no-textconv", "--no-index", "--", "/dev/null", request.path],
								{
									ok: [1],
								},
							)
						: await git(root, [
								"diff",
								"--no-ext-diff",
								"--no-textconv",
								...(request.staged ? ["--cached"] : []),
								"--",
								path,
							]),
				};
			}),
		run: (request) =>
			attempt(async () => {
				const root = await repositoryRoot(request.root);
				const steps = await argumentsFor(root, request.action);
				const input =
					request.action.kind === "commit" && request.action.message.trim() ? request.action.message : undefined;
				let output = "";
				for (const args of steps) output += await git(root, args, { input, combined: true });
				return { output: output.trim() };
			}),
	};
}
