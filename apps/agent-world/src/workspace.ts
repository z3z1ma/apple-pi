export type WorkspaceResult<T> = ({ ok: true } & T) | { ok: false; reason: string; conflict?: boolean };
export type WorkspaceReadResult =
	| WorkspaceResult<{ root: string; path: string; text: string; hash: string }>
	| { ok: false; reason: string; nonTextFile: string };
export interface WorkspacePath {
	root: string;
	path: string;
}
export interface WorkspaceResolvePaths {
	paths: string[];
	cwd?: string;
}
export interface WorkspaceResolvedPath extends WorkspacePath {
	candidate: string;
}
export interface WorkspaceSave extends WorkspacePath {
	text: string;
	baseHash: string;
}
export interface WorkspaceDiff extends WorkspacePath {
	staged?: boolean;
}
export interface WorkspaceEntry {
	name: string;
	path: string;
	kind: "directory" | "file" | "symlink" | "other";
}
export interface WorkspaceGitEntry {
	path: string;
	previousPath?: string;
	index: string;
	worktree: string;
}
export interface WorkspaceWorktree {
	path: string;
	branch: string | null;
	head: string | null;
	detached: boolean;
	bare: boolean;
	current: boolean;
	locked?: string;
	prunable?: string;
}
export interface WorkspaceApi {
	resolvePaths(request: WorkspaceResolvePaths): Promise<WorkspaceResult<{ files: WorkspaceResolvedPath[] }>>;
	repositories(): Promise<WorkspaceResult<{ roots: string[] }>>;
	files(request: { root: string }): Promise<WorkspaceResult<{ root: string; paths: string[] }>>;
	worktrees(request: { root: string }): Promise<WorkspaceResult<{ root: string; worktrees: WorkspaceWorktree[] }>>;
	tree(request: WorkspacePath): Promise<WorkspaceResult<{ root: string; path: string; entries: WorkspaceEntry[] }>>;
	readFile(request: WorkspacePath): Promise<WorkspaceReadResult>;
	saveFile(request: WorkspaceSave): Promise<WorkspaceResult<{ hash: string }>>;
	gitStatus(request: {
		root: string;
	}): Promise<WorkspaceResult<{ entries: WorkspaceGitEntry[]; branch: string | null }>>;
	gitDiff(request: WorkspaceDiff): Promise<WorkspaceResult<{ text: string }>>;
}
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
export const isWorkspaceResolvePaths = (value: unknown): value is WorkspaceResolvePaths =>
	object(value) &&
	Array.isArray(value.paths) &&
	value.paths.every((path) => typeof path === "string") &&
	(value.cwd === undefined || typeof value.cwd === "string");
export const isWorkspaceRoot = (value: unknown): value is { root: string } =>
	object(value) && typeof value.root === "string";
export const isWorkspacePath = (value: unknown): value is WorkspacePath =>
	isWorkspaceRoot(value) && "path" in value && typeof value.path === "string";
export const isWorkspaceSave = (value: unknown): value is WorkspaceSave =>
	isWorkspacePath(value) &&
	"text" in value &&
	typeof value.text === "string" &&
	"baseHash" in value &&
	typeof value.baseHash === "string";
export const isWorkspaceDiff = (value: unknown): value is WorkspaceDiff =>
	isWorkspacePath(value) && (!("staged" in value) || value.staged === undefined || typeof value.staged === "boolean");
