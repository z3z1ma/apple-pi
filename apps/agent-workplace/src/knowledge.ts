export type KnowledgeMode = "context" | "wiki";
export type KnowledgeEdgeKind = "coupled" | "verify" | "wiki";

export interface KnowledgeNode {
	id: string;
	path: string;
	label: string;
	group: string;
	kind: "context" | "wiki" | "file" | "missing";
	document?: string;
	source?: string;
}

export interface KnowledgeEdge {
	from: string;
	to: string;
	kind: KnowledgeEdgeKind;
	line: number;
	target?: string;
}

export interface KnowledgeGraph {
	root: string;
	mode: KnowledgeMode;
	nodes: KnowledgeNode[];
	edges: KnowledgeEdge[];
	warnings: string[];
}

export interface KnowledgeRequest {
	root: string;
	mode: KnowledgeMode;
}

export type KnowledgeResult<T> = { ok: true; value: T } | { ok: false; reason: string };

export interface KnowledgeApi {
	graph(request: KnowledgeRequest): Promise<KnowledgeResult<KnowledgeGraph>>;
	content(request: KnowledgeRequest & { id: string }): Promise<KnowledgeResult<{ node: KnowledgeNode; text: string }>>;
}

export function isKnowledgeRequest(value: unknown): value is KnowledgeRequest {
	if (!value || typeof value !== "object") return false;
	const request = value as KnowledgeRequest;
	return typeof request.root === "string" && (request.mode === "context" || request.mode === "wiki");
}
