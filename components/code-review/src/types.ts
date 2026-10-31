export type ReviewTarget =
	| { kind: "working-tree"; base: string }
	| { kind: "staged" }
	| { kind: "commit"; commit: string; parent?: string }
	| { kind: "range"; base: string; head: string }
	| { kind: "branch"; base: string; head: string };

export interface ReviewRequest {
	cwd: string;
	target: ReviewTarget;
	paths?: string[];
	intent?: { text: string } | { path: string };
	lenses?: string[];
}

export interface SourceEntry {
	path: string;
	mode: string;
	blob: string;
	content: "text" | "binary" | "symlink" | "submodule" | "lfs";
}

export interface ChangeRegion {
	id: string;
	path: string;
	kind: "text" | "non-text";
	oldStart: number;
	oldCount: number;
	newStart: number;
	newCount: number;
	patch: string;
}

export interface ReviewConfiguration {
	instructions: { planning: string; inspection: string; validation: string };
	roleReferences: { role: string; models: string[] }[];
	catalogIssues: number;
}

export interface ReviewArtifact {
	version: 1;
	digest: string;
	request: ReviewRequest;
	repository: string;
	commonDirectory: string;
	source: string;
	baseCommit: string | null;
	headCommit: string | null;
	baseTree: string;
	headTree: string;
	baseRevision: string;
	headRevision: string;
	files: SourceEntry[];
	index: { path: string; mode: string; blob: string }[] | null;
	intent: { origin: string; text: string; hash: string } | null;
	configuration?: ReviewConfiguration;
	regions: ChangeRegion[];
	changes: { status: string; path: string; previousPath?: string }[];
	omissions: { path: string; reason: string }[];
	patchHash: string;
	startedAt: number;
	capturedAt: number;
}
