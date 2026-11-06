import type { GitTarget } from "../../shared/src/git-change.js";

export type ReviewTarget = GitTarget;

export interface ReviewRequest {
	cwd: string;
	target: ReviewTarget;
	paths?: string[];
	intent?: { text: string } | { path: string };
	lenses?: string[];
	workers?: string[];
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
	instructions: { planning: string; inspection: string; validation?: string; duplicates?: string };
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
	files: Pick<SourceEntry, "path" | "mode" | "blob">[];
	index: string | { path: string; mode: string; blob: string }[] | null;
	intent: { origin: string; text: string; hash: string } | null;
	configuration?: ReviewConfiguration;
	regions: ChangeRegion[];
	changes: { status: string; path: string; previousPath?: string }[];
	omissions: { path: string; reason: string }[];
	patchHash: string;
	startedAt: number;
	capturedAt: number;
	label?: ReviewLabel;
}

export interface ReviewLabel {
	branch: string | null;
	subject: string | null;
	commits: number | null;
}
