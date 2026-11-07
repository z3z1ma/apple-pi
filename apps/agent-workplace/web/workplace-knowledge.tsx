import { useContext, useEffect, useState } from "react";
import type { KnowledgeGraph, KnowledgeMode, KnowledgeNode } from "../src/knowledge.js";
import { FileReferenceCwd, FileReferenceNavigation } from "./file-references.js";
import { KnowledgeGraphView } from "./knowledge-graph.js";
import { Markdown } from "./overlay/conversation/transcript.js";
import { Select } from "./workplace-fields.js";
import { chooseRepository as setRoot, useRepository } from "./workplace-repository.js";
import "./workplace-knowledge.css";

function KnowledgeBody({ graph, active }: { graph: KnowledgeGraph; active: boolean }) {
	const navigate = useContext(FileReferenceNavigation);
	const [search, setSearch] = useState("");
	const [selected, setSelected] = useState<string>();
	const [loadedContent, setContent] = useState<{ node: KnowledgeNode; text: string }>();
	const content = loadedContent?.node.id === selected ? loadedContent : undefined;
	const [error, setError] = useState<string>();
	useEffect(() => {
		if (!selected || !active) return;
		let live = true;
		setContent(undefined);
		setError(undefined);
		void window.agentWorkplace.knowledge
			.content({ root: graph.root, mode: graph.mode, id: selected })
			.then((result) => {
				if (!live) return;
				if (result.ok) setContent(result.value);
				else setError(result.reason);
			})
			.catch((reason) => {
				if (live) setError(String(reason));
			});
		return () => {
			live = false;
		};
	}, [selected, graph, active]);
	const matches = search.trim()
		? graph.nodes.filter((node) => node.path.toLowerCase().includes(search.trim().toLowerCase()))
		: [];
	const links = graph.edges.filter((edge) => edge.from === selected || edge.to === selected);
	const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
	const wikiLinks = Object.fromEntries(
		links
			.filter((edge) => edge.kind === "wiki" && edge.from === selected && edge.target !== undefined)
			.map((edge) => [edge.target!.normalize("NFKC").toLowerCase(), edge.to]),
	);
	return (
		<div className={`wp-knowledge-body${selected ? " has-detail" : ""}`}>
			<div className="wp-knowledge-map">
				<div className="wp-knowledge-search">
					<input
						type="search"
						aria-label="Find a node"
						placeholder="Find a file or page..."
						value={search}
						onChange={(event) => setSearch(event.target.value)}
					/>
					{search.trim() && (
						<ul aria-label="Matching nodes">
							{matches.map((node) => (
								<li key={node.id}>
									<button
										type="button"
										onClick={() => {
											setSelected(node.id);
											setSearch("");
										}}
									>
										{node.path}
									</button>
								</li>
							))}
							{!matches.length && <li>No matching nodes</li>}
						</ul>
					)}
				</div>
				<KnowledgeGraphView graph={graph} active={active} selected={selected} onSelect={setSelected} />
				{!graph.nodes.length && (
					<p className="wp-knowledge-empty">
						No {graph.mode === "context" ? ".context files" : ".wiki pages"} in this repository.
					</p>
				)}
			</div>
			{selected && (
				<aside className="wp-knowledge-detail" aria-label="Knowledge reader">
					<header>
						<h2>{nodes.get(selected)?.path ?? selected}</h2>
						<button type="button" aria-label="Close knowledge reader" onClick={() => setSelected(undefined)}>
							Close
						</button>
					</header>
					{error ? (
						<p role="alert">{error}</p>
					) : !content ? (
						<p role="status">Reading node...</p>
					) : (
						<>
							{content.node.source && navigate && (
								<button
									type="button"
									className="wp-knowledge-source"
									onClick={() => navigate({ root: graph.root, path: content.node.source! })}
								>
									Open source in Code
								</button>
							)}
							{content.text ? (
								<FileReferenceCwd.Provider value={graph.root}>
									<Markdown
										text={content.text}
										wikiLinks={wikiLinks}
										onLink={(href, file) => {
											if (href.startsWith("#knowledge/"))
												setSelected(decodeURIComponent(href.slice("#knowledge/".length)));
											else if (!file) void window.agentWorkplace.openLink(href);
										}}
									/>
								</FileReferenceCwd.Provider>
							) : (
								<p>
									{content.node.kind === "missing"
										? "This target is missing or cannot be resolved safely."
										: "This file has no context document."}
								</p>
							)}
						</>
					)}
					<h3>Links</h3>
					{links.length ? (
						<ul className="wp-knowledge-links">
							{links.map((edge) => {
								const id = edge.from === selected ? edge.to : edge.from;
								return (
									<li key={JSON.stringify(edge)}>
										<button type="button" onClick={() => setSelected(id)}>
											<span className={`is-${edge.kind}`}>{edge.kind}</span>
											<span>{nodes.get(id)?.path ?? id}</span>
											<small>{edge.from === selected ? "outgoing" : "incoming"}</small>
										</button>
									</li>
								);
							})}
						</ul>
					) : (
						<p>No links</p>
					)}
				</aside>
			)}
		</div>
	);
}

export function WorkplaceKnowledge({ active }: { active: boolean }) {
	const root = useRepository();
	const [roots, setRoots] = useState<string[]>([]);
	const [manualRoot, setManualRoot] = useState("");
	const [mode, setMode] = useState<KnowledgeMode>("context");
	const [refresh, setRefresh] = useState(0);
	const [loaded, setLoaded] = useState<{ key: string; graph: KnowledgeGraph }>();
	const [error, setError] = useState<{ key: string; reason: string }>();
	const [pendingKey, setPendingKey] = useState<string>();
	const key = JSON.stringify([root, mode, refresh]);
	const loading = pendingKey === key && loaded?.key !== key;
	const [repositoryError, setRepositoryError] = useState<string>();
	useEffect(() => {
		let live = true;
		void window.agentWorkplace.workspace
			.repositories()
			.then((result) => {
				if (!live) return;
				if (!result.ok) {
					setRepositoryError(result.reason);
					return;
				}
				setRoots(result.roots);
				setRoot((previous) => previous || result.roots[0] || "");
			})
			.catch((reason) => {
				if (live) setRepositoryError(String(reason));
			});
		return () => {
			live = false;
		};
	}, []);
	useEffect(() => {
		if (!active || !root || loaded?.key === key) return;
		let live = true;
		setPendingKey(key);
		setError(undefined);
		void window.agentWorkplace.knowledge
			.graph({ root, mode })
			.then((result) => {
				if (!live) return;
				if (result.ok) setLoaded({ key, graph: result.value });
				else setError({ key, reason: result.reason });
			})
			.catch((reason) => {
				if (live) setError({ key, reason: String(reason) });
			})
			.finally(() => {
				if (live) setPendingKey(undefined);
			});
		return () => {
			live = false;
		};
	}, [active, root, mode, key, loaded?.key]);
	const graph = loaded?.key === key ? loaded.graph : undefined;
	const repositories = [...new Set([...roots, root].filter(Boolean))];
	return (
		<section className="wp-knowledge-view" aria-label="Repository knowledge">
			<header className="wp-knowledge-toolbar">
				<div>
					<h1>Knowledge</h1>
					<small>
						{graph ? `${graph.nodes.length} nodes / ${graph.edges.length} links` : "Repository context and wiki"}
					</small>
				</div>
				<Select
					label="Knowledge repository"
					value={root}
					placeholder="Choose a repository"
					options={repositories.map((path) => ({ value: path, label: path.split("/").at(-1) ?? path, detail: path }))}
					onChange={setRoot}
				/>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						if (manualRoot.trim()) {
							setRoot(manualRoot.trim());
							setManualRoot("");
						}
					}}
				>
					<input
						aria-label="Knowledge repository path"
						placeholder="Absolute directory"
						value={manualRoot}
						onChange={(event) => setManualRoot(event.target.value)}
					/>
					<button type="submit">Open</button>
				</form>
				<Select
					label="Knowledge mode"
					value={mode}
					options={[
						{ value: "context", label: ".context" },
						{ value: "wiki", label: ".wiki" },
					]}
					onChange={(value) => setMode(value as KnowledgeMode)}
				/>
				<button type="button" onClick={() => setRefresh((value) => value + 1)} disabled={!root || loading}>
					Refresh
				</button>
			</header>
			{repositoryError && <p role="alert">{repositoryError}</p>}
			{error?.key === key && (
				<p className="wp-knowledge-error" role="alert">
					{error.reason}
				</p>
			)}
			{loading && (
				<span className="wp-knowledge-loading" role="status">
					Loading graph...
				</span>
			)}
			{graph ? (
				<KnowledgeBody key={key} graph={graph} active={active} />
			) : !root ? (
				<p className="wp-knowledge-empty">Choose a repository to explore its knowledge.</p>
			) : null}
			{!!graph?.warnings.length && (
				<details className="wp-knowledge-warnings">
					<summary>{graph.warnings.length} knowledge warnings</summary>
					<ul>
						{[...new Set(graph.warnings)].map((warning) => (
							<li key={warning}>{warning}</li>
						))}
					</ul>
				</details>
			)}
		</section>
	);
}
