import { lstat, readdir, realpath } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { contextReferences } from "../../../../components/code-context/src/lint.js";
import { loadWikiGraph, resolveWikiSlug } from "../../../../components/wiki/src/graph.js";
import type { KnowledgeApi, KnowledgeGraph, KnowledgeNode, KnowledgeRequest } from "../knowledge.js";
import { isKnowledgeRequest } from "../knowledge.js";
import type { WorkspaceApi } from "../workspace.js";
import { directory, failure, within } from "./workspace.js";

async function present(path: string) {
	try {
		return await lstat(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

async function sourceExists(root: string, path: string): Promise<boolean> {
	try {
		const named = resolve(root, path);
		within(root, named);
		const canonical = await realpath(named);
		within(root, canonical);
		return (await lstat(canonical)).isFile();
	} catch {
		return false;
	}
}

function nodeFor(id: string, kind: KnowledgeNode["kind"], document?: string): KnowledgeNode {
	return { id, path: id, label: id.split("/").at(-1) ?? id, group: dirname(id), kind, document };
}

async function extract(workspace: WorkspaceApi, request: KnowledgeRequest): Promise<KnowledgeGraph> {
	if (!isKnowledgeRequest(request)) throw new Error("Choose a repository and knowledge mode.");
	const root = directory(request.root);
	const graph: KnowledgeGraph = { root, mode: request.mode, nodes: [], edges: [], warnings: [] };
	const folder = join(root, request.mode === "context" ? ".context" : ".wiki");
	const stat = await present(folder);
	if (!stat) return graph;
	if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Knowledge folders must be real directories.");
	const includePath = (path: string) => {
		try {
			within(root, path);
			return true;
		} catch {
			return false;
		}
	};
	let wiki: ReturnType<typeof loadWikiGraph> | undefined;
	function readWiki() {
		wiki ??= loadWikiGraph(root, undefined, includePath).then((loaded) => {
			if (loaded.projectRoot !== root) throw new Error("Choose the repository root to read its wiki.");
			graph.warnings.push(...loaded.findings.map((finding) => finding.message));
			return loaded;
		});
		return wiki;
	}
	if (request.mode === "wiki") {
		const loaded = await readWiki();
		graph.nodes = loaded.pages.map((page) => nodeFor(page.path, "wiki", page.path));
		graph.edges = loaded.edges.map((edge) => ({ ...edge, kind: "wiki" }));
		return graph;
	}
	const nodes = new Map<string, KnowledgeNode>();
	const documents: { id: string; text: string }[] = [];
	async function visit(folder: string): Promise<void> {
		for (const entry of await readdir(folder, { withFileTypes: true })) {
			const absolute = join(folder, entry.name);
			if (!includePath(absolute)) continue;
			const path = relative(root, absolute).split(sep).join("/");
			if (entry.isSymbolicLink()) {
				graph.warnings.push(`${path} is a symlink and was not followed`);
				continue;
			}
			if (entry.isDirectory()) {
				await visit(absolute);
				continue;
			}
			if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
			const content = await workspace.readFile({ root, path });
			if (!content.ok) throw new Error(content.reason);
			const id = path.slice(".context/".length, -".md".length);
			const node = nodeFor(id, "context", path);
			if (await sourceExists(root, id)) node.source = id;
			else graph.warnings.push(`${path}: source ${id} is missing or unavailable`);
			nodes.set(id, node);
			documents.push({ id, text: content.text });
		}
	}
	await visit(folder);
	for (const document of documents) {
		for (const reference of contextReferences(document.text)) {
			let target: KnowledgeNode;
			if (reference.kind === "wiki") {
				try {
					const page = resolveWikiSlug(await readWiki(), reference.target);
					target = nodeFor(page.path, "wiki", page.path);
				} catch (error) {
					target = nodeFor(`wiki:${reference.target}`, "missing");
					graph.warnings.push(`${document.id}:${reference.line}: ${String(error)}`);
				}
			} else {
				try {
					const absolute = resolve(root, reference.target);
					within(root, absolute);
					const path = relative(root, absolute).split(sep).join("/");
					target = nodes.get(path) ?? nodeFor(path, "file");
					if (!nodes.has(path)) {
						if (await sourceExists(root, path)) target.source = path;
						else target.kind = "missing";
					}
				} catch (error) {
					target = nodeFor(`path:${reference.target}`, "missing");
					graph.warnings.push(`${document.id}:${reference.line}: ${String(error)}`);
				}
			}
			if (!nodes.has(target.id)) nodes.set(target.id, target);
			graph.edges.push({ from: document.id, to: target.id, kind: reference.kind, line: reference.line });
		}
	}
	graph.nodes = [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
	graph.edges = [...new Map(graph.edges.map((edge) => [JSON.stringify(edge), edge])).values()];
	return graph;
}

export function openKnowledge(workspace: WorkspaceApi): KnowledgeApi {
	return {
		async graph(request) {
			try {
				return { ok: true, value: await extract(workspace, request) };
			} catch (error) {
				return failure(error);
			}
		},
		async content(request) {
			try {
				const graph = await extract(workspace, request);
				const node = graph.nodes.find((node) => node.id === request.id);
				if (!node) throw new Error("This node is no longer in the graph. Refresh to read current knowledge.");
				let text = "";
				if (node.document) {
					const result = await workspace.readFile({ root: graph.root, path: node.document });
					if (!result.ok) throw new Error(result.reason);
					text = result.text;
				}
				return { ok: true, value: { node, text } };
			} catch (error) {
				return failure(error);
			}
		},
	};
}
