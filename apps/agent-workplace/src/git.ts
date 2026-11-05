import type { WorkspaceResult, WorkspaceWorktree } from "./workspace.js";

export interface GitChange {
	path: string;
	previousPath?: string;
	index: string;
	worktree: string;
}

export interface GitRef {
	name: string;
	kind: "local" | "remote" | "tag";
	target: string;
	current: boolean;
	upstream?: string;
	ahead?: number;
	behind?: number;
	gone?: boolean;
}

export interface GitStash {
	index: number;
	message: string;
	date: number;
}

export type GitState = "clean" | "merging" | "rebasing" | "cherry-picking" | "reverting";

export interface GitOverview {
	root: string;
	branch: string | null;
	head: string | null;
	upstream: string | null;
	ahead: number;
	behind: number;
	state: GitState;
	remotes: string[];
	refs: GitRef[];
	stashes: GitStash[];
	worktrees: WorkspaceWorktree[];
	changes: GitChange[];
}

export interface GitCommit {
	sha: string;
	parents: string[];
	author: string;
	email: string;
	date: number;
	subject: string;
	refs: string[];
}

export interface GitFileChange {
	path: string;
	previousPath?: string;
	status: string;
}

export interface GitCommitDetail extends GitCommit {
	body: string;
	committer: string;
	committed: number;
	files: GitFileChange[];
}

export type GitDiffRequest =
	| { root: string; path: string; staged: boolean }
	| { root: string; path: string; commit: string };

export type GitAction =
	| { kind: "stage"; paths: string[] }
	| { kind: "unstage"; paths: string[] }
	| { kind: "discard"; paths: string[] }
	| { kind: "commit"; message: string; amend: boolean }
	| { kind: "checkout"; ref: string }
	| { kind: "checkoutCommit"; sha: string }
	| { kind: "createBranch"; name: string; from: string; checkout: boolean }
	| { kind: "deleteBranch"; name: string; force: boolean }
	| { kind: "merge"; ref: string }
	| { kind: "rebase"; onto: string }
	| { kind: "abort" }
	| { kind: "continue" }
	| { kind: "fetch" }
	| { kind: "pull" }
	| { kind: "push"; force: boolean }
	| { kind: "stashSave"; message: string; untracked: boolean }
	| { kind: "stashApply"; index: number }
	| { kind: "stashPop"; index: number }
	| { kind: "stashDrop"; index: number }
	| { kind: "cherryPick"; sha: string }
	| { kind: "revert"; sha: string }
	| { kind: "reset"; sha: string; mode: "soft" | "mixed" | "hard" }
	| { kind: "createTag"; name: string; sha: string }
	| { kind: "deleteTag"; name: string };

export interface GitApi {
	overview(request: { root: string }): Promise<WorkspaceResult<{ overview: GitOverview }>>;
	log(request: { root: string; skip: number; limit: number }): Promise<WorkspaceResult<{ commits: GitCommit[] }>>;
	show(request: { root: string; sha: string }): Promise<WorkspaceResult<{ commit: GitCommitDetail }>>;
	diff(request: GitDiffRequest): Promise<WorkspaceResult<{ text: string }>>;
	run(request: { root: string; action: GitAction }): Promise<WorkspaceResult<{ output: string }>>;
}

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const text = (value: unknown): value is string => typeof value === "string";
const texts = (value: unknown): value is string[] => Array.isArray(value) && value.every(text);
const count = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

export const isGitRoot = (value: unknown): value is { root: string } => object(value) && text(value.root);
export const isGitLog = (value: unknown): value is { root: string; skip: number; limit: number } =>
	isGitRoot(value) && count((value as Record<string, unknown>).skip) && count((value as Record<string, unknown>).limit);
export const isGitShow = (value: unknown): value is { root: string; sha: string } =>
	isGitRoot(value) && text((value as Record<string, unknown>).sha);
export const isGitDiff = (value: unknown): value is GitDiffRequest =>
	isGitRoot(value) &&
	text((value as Record<string, unknown>).path) &&
	(typeof (value as Record<string, unknown>).staged === "boolean" || text((value as Record<string, unknown>).commit));

const ACTION_FIELDS: Record<GitAction["kind"], Record<string, (value: unknown) => boolean>> = {
	stage: { paths: texts },
	unstage: { paths: texts },
	discard: { paths: texts },
	commit: { message: text, amend: (value) => typeof value === "boolean" },
	checkout: { ref: text },
	checkoutCommit: { sha: text },
	createBranch: { name: text, from: text, checkout: (value) => typeof value === "boolean" },
	deleteBranch: { name: text, force: (value) => typeof value === "boolean" },
	merge: { ref: text },
	rebase: { onto: text },
	abort: {},
	continue: {},
	fetch: {},
	pull: {},
	push: { force: (value) => typeof value === "boolean" },
	stashSave: { message: text, untracked: (value) => typeof value === "boolean" },
	stashApply: { index: count },
	stashPop: { index: count },
	stashDrop: { index: count },
	cherryPick: { sha: text },
	revert: { sha: text },
	reset: { sha: text, mode: (value) => value === "soft" || value === "mixed" || value === "hard" },
	createTag: { name: text, sha: text },
	deleteTag: { name: text },
};

export const isGitRun = (value: unknown): value is { root: string; action: GitAction } => {
	if (!isGitRoot(value)) return false;
	const action = (value as Record<string, unknown>).action;
	if (!object(action) || !text(action.kind) || !(action.kind in ACTION_FIELDS)) return false;
	return Object.entries(ACTION_FIELDS[action.kind as GitAction["kind"]]).every(([field, valid]) =>
		valid(action[field]),
	);
};
