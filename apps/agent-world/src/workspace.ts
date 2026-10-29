export type WorkspaceResult<T> = ({ ok: true } & T) | { ok: false; reason: string; conflict?: boolean };
export interface WorkspacePath {
	root: string;
	path: string;
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
	repositories(): Promise<WorkspaceResult<{ roots: string[] }>>;
	files(request: { root: string }): Promise<WorkspaceResult<{ root: string; paths: string[] }>>;
	worktrees(request: { root: string }): Promise<WorkspaceResult<{ root: string; worktrees: WorkspaceWorktree[] }>>;
	tree(request: WorkspacePath): Promise<WorkspaceResult<{ root: string; path: string; entries: WorkspaceEntry[] }>>;
	readFile(
		request: WorkspacePath,
	): Promise<WorkspaceResult<{ root: string; path: string; text: string; hash: string }>>;
	saveFile(request: WorkspaceSave): Promise<WorkspaceResult<{ hash: string }>>;
	gitStatus(request: {
		root: string;
	}): Promise<WorkspaceResult<{ entries: WorkspaceGitEntry[]; branch: string | null }>>;
	gitDiff(request: WorkspaceDiff): Promise<WorkspaceResult<{ text: string }>>;
}
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
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
