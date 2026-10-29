import type { editor } from "monaco-editor";
import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspaceEntry } from "../src/workspace.js";
import type { WorldSnapshot } from "../src/world.js";
import { GitDiffText, type GitDiffView, GitPane } from "./workplace-git.js";
import "./workplace-code.css";

type MonacoModule = typeof import("./workplace-monaco.js");
type Buffer = {
	root: string;
	path: string;
	text: string;
	base: string;
	hash: string;
	external?: { text: string; hash: string };
	model?: editor.ITextModel;
	listener?: { dispose(): void };
};
const api = window.agentWorld;
const fileKey = (root: string, path: string) => JSON.stringify([root, path]);

function FileTree({
	entries,
	expanded,
	selected,
	onToggle,
	onOpen,
	depth = 0,
	path = "",
}: {
	entries: Record<string, WorkspaceEntry[]>;
	expanded: Set<string>;
	selected?: string;
	onToggle(path: string): void;
	onOpen(path: string): void;
	depth?: number;
	path?: string;
}) {
	return (
		<ul className="wp-code-tree-list">
			{(entries[path] ?? []).map((entry) => (
				<li key={entry.path}>
					<button
						type="button"
						className={selected === entry.path ? "is-selected" : ""}
						style={{ paddingLeft: 12 + depth * 14 }}
						aria-expanded={entry.kind === "directory" ? expanded.has(entry.path) : undefined}
						title={entry.path}
						onClick={() => (entry.kind === "directory" ? onToggle(entry.path) : onOpen(entry.path))}
					>
						<span className="wp-code-file-icon" aria-hidden="true">
							{entry.kind === "directory" ? (expanded.has(entry.path) ? "▾" : "▸") : "·"}
						</span>
						<span>{entry.name}</span>
						{entry.kind === "symlink" && <small>link</small>}
					</button>
					{entry.kind === "directory" && expanded.has(entry.path) && (
						<FileTree
							entries={entries}
							expanded={expanded}
							selected={selected}
							onToggle={onToggle}
							onOpen={onOpen}
							depth={depth + 1}
							path={entry.path}
						/>
					)}
				</li>
			))}
		</ul>
	);
}

export function WorkplaceCode({
	world,
	active,
	onDirtyChange,
}: {
	world: WorldSnapshot;
	active: boolean;
	onDirtyChange?: (dirty: boolean) => void;
}) {
	const [roots, setRoots] = useState<string[]>([]);
	const [root, setRoot] = useState("");
	const rootRef = useRef(root);
	rootRef.current = root;
	const [manualRoot, setManualRoot] = useState("");
	const [entries, setEntries] = useState<Record<string, WorkspaceEntry[]>>({});
	const [expanded, setExpanded] = useState(new Set<string>());
	const [selected, setSelected] = useState<string>();
	const [error, setError] = useState<string>();
	const [notice, setNotice] = useState<string>();
	const [busy, setBusy] = useState(false);
	const [saving, setSaving] = useState(false);
	const [showGit, setShowGit] = useState(true);
	const [diff, setDiff] = useState<GitDiffView>();
	const buffers = useRef(new Map<string, Buffer>());
	const [, redraw] = useState(0);
	const [loaded, setLoaded] = useState<MonacoModule>();
	const container = useRef<HTMLDivElement>(null);
	const instance = useRef<editor.IStandaloneCodeEditor | undefined>(undefined);
	const openRequest = useRef(0);
	const savingRef = useRef(false);
	const saveRef = useRef<() => void>(() => {});
	const current = selected ? buffers.current.get(selected) : undefined;
	const dirty = current !== undefined && current.text !== current.base;
	const repositoryList = [...new Set([...roots, root].filter(Boolean))];
	const changedElsewhere = [...buffers.current.values()].filter(
		(buffer) => buffer.root !== root && buffer.text !== buffer.base,
	).length;
	const retainedDirty = [...buffers.current.values()].some(
		(buffer) => buffer.text !== buffer.base || !!buffer.external,
	);
	useEffect(() => {
		onDirtyChange?.(retainedDirty);
	}, [retainedDirty, onDirtyChange]);

	useEffect(() => {
		let live = true;
		void import("./workplace-monaco.js")
			.then((module) => {
				if (live) setLoaded(module);
			})
			.catch((reason) => {
				if (live) setError(`Editor could not load: ${String(reason)}`);
			});
		return () => {
			live = false;
		};
	}, []);

	useEffect(() => {
		if (!loaded || !container.current) return;
		const host = container.current;
		const app = host.closest("[data-appearance]");
		const updateTheme = () => {
			const base = app?.getAttribute("data-appearance") === "dark" ? "vs-dark" : "vs";
			if (!app) {
				loaded.monaco.editor.setTheme(base);
				return;
			}
			const styles = getComputedStyle(app);
			const color = (name: string) =>
				styles
					.getPropertyValue(name)
					.trim()
					.replace(/^#([\da-f])([\da-f])([\da-f])$/i, "#$1$1$2$2$3$3");
			loaded.monaco.editor.defineTheme("workplace-code", {
				base,
				inherit: true,
				rules: [],
				colors: {
					"editor.background": color("--wp-bg"),
					"editor.foreground": color("--wp-text"),
					"editorGutter.background": color("--wp-bg"),
					"editorLineNumber.foreground": color("--wp-muted"),
					"editor.selectionBackground": color("--wp-selected"),
					"editorCursor.foreground": color("--wp-accent"),
					"editor.lineHighlightBackground": color("--wp-panel"),
				},
			});
			loaded.monaco.editor.setTheme("workplace-code");
		};
		updateTheme();
		const observer = new MutationObserver(updateTheme);
		if (app) observer.observe(app, { attributes: true, attributeFilter: ["data-appearance"] });
		const created = loaded.monaco.editor.create(host, {
			model: null,
			automaticLayout: true,
			minimap: { enabled: false },
			fontSize: 13,
			scrollBeyondLastLine: false,
			padding: { top: 12 },
			renderWhitespace: "selection",
			fixedOverflowWidgets: true,
		});
		instance.current = created;
		created.addCommand(loaded.monaco.KeyMod.CtrlCmd | loaded.monaco.KeyCode.KeyS, () => saveRef.current());
		return () => {
			observer.disconnect();
			created.dispose();
			instance.current = undefined;
			for (const buffer of buffers.current.values()) {
				buffer.listener?.dispose();
				buffer.model?.dispose();
				buffer.model = undefined;
			}
			loaded.disposeWorkers();
		};
	}, [loaded]);

	useEffect(() => {
		if (!loaded || !instance.current) return;
		if (!current) {
			instance.current.setModel(null);
			return;
		}
		if (!current.model) {
			// Overlapping workspace roots can open the same file with separate retained drafts.
			current.model = loaded.monaco.editor.createModel(
				current.text,
				undefined,
				loaded.monaco.Uri.from({
					scheme: "workplace",
					authority: encodeURIComponent(current.root),
					path: `/${current.path}`,
				}),
			);
			current.listener = current.model.onDidChangeContent(() => {
				current.text = current.model!.getValue(undefined, true);
				redraw((version) => version + 1);
			});
		}
		instance.current.setModel(current.model);
		if (active) instance.current.layout();
	}, [current, loaded, active]);

	useEffect(() => {
		let live = true;
		void api.workspace
			.repositories()
			.then((result) => {
				if (!live) return;
				if (!result.ok) {
					setError(result.reason);
					return;
				}
				setRoots(result.roots);
				setRoot((existing) => existing || result.roots[0] || "");
			})
			.catch((reason) => {
				if (live) setError(String(reason));
			});
		return () => {
			live = false;
		};
	}, []);

	const loadDirectory = useCallback(async (directory: string, repository = rootRef.current) => {
		if (!repository) return;
		try {
			const result = await api.workspace.tree({ root: repository, path: directory });
			if (repository !== rootRef.current) return;
			if (!result.ok) {
				setError(result.reason);
				return;
			}
			if (directory === "" && result.root !== repository) {
				setRoots((before) => [...new Set([...before.filter((item) => item !== repository), result.root])]);
				setRoot(result.root);
				return;
			}
			setEntries((before) => ({ ...before, [directory]: result.entries }));
		} catch (reason) {
			if (repository === rootRef.current) setError(String(reason));
		}
	}, []);

	useEffect(() => {
		setEntries({});
		setExpanded(new Set());
		setSelected(undefined);
		setDiff(undefined);
		setError(undefined);
		setNotice(undefined);
		openRequest.current++;
		void loadDirectory("", root);
	}, [root, loadDirectory]);

	const readBuffer = useCallback(async (buffer: Buffer) => {
		const baseHash = buffer.hash;
		const result = await api.workspace.readFile({ root: buffer.root, path: buffer.path });
		if (baseHash !== buffer.hash) return;
		if (!result.ok) throw new Error(result.reason);
		if (result.hash === buffer.hash) return;
		if (buffer.text !== buffer.base) {
			buffer.external = { text: result.text, hash: result.hash };
		} else {
			buffer.base = result.text;
			buffer.text = result.text;
			buffer.hash = result.hash;
			buffer.external = undefined;
			buffer.model?.setValue(result.text);
		}
		redraw((version) => version + 1);
	}, []);

	useEffect(() => {
		if (!active || !current) return;
		const check = () => {
			void readBuffer(current).catch((reason) => setError(String(reason)));
		};
		check();
		window.addEventListener("focus", check);
		return () => window.removeEventListener("focus", check);
	}, [active, current, readBuffer]);

	const openFile = async (path: string) => {
		setDiff(undefined);
		const repository = root;
		const request = ++openRequest.current;
		const key = fileKey(repository, path);
		const existing = buffers.current.get(key);
		setError(undefined);
		setNotice(undefined);
		if (existing) {
			setBusy(false);
			setSelected(key);
			return;
		}
		setBusy(true);
		try {
			const result = await api.workspace.readFile({ root: repository, path });
			if (request !== openRequest.current || repository !== rootRef.current) return;
			if (!result.ok) {
				setError(result.reason);
				return;
			}
			buffers.current.set(key, { root: repository, path, text: result.text, base: result.text, hash: result.hash });
			setSelected(key);
		} catch (reason) {
			if (request === openRequest.current) setError(String(reason));
		} finally {
			if (request === openRequest.current) setBusy(false);
		}
	};

	const save = async () => {
		if (!current || savingRef.current || current.text === current.base || current.external) return;
		const buffer = current;
		const text = buffer.text;
		savingRef.current = true;
		setSaving(true);
		setError(undefined);
		try {
			const result = await api.workspace.saveFile({
				root: buffer.root,
				path: buffer.path,
				text,
				baseHash: buffer.hash,
			});
			if (!result.ok) {
				setError(result.reason);
				if (result.conflict) await readBuffer(buffer);
				return;
			}
			buffer.hash = result.hash;
			buffer.base = text;
			if (buffer.external?.hash === result.hash) buffer.external = undefined;
			setNotice(`Saved ${buffer.path}`);
			redraw((version) => version + 1);
		} catch (reason) {
			setError(String(reason));
		} finally {
			savingRef.current = false;
			setSaving(false);
		}
	};
	saveRef.current = () => {
		if (active && !diff) void save();
	};
	const switchRoot = (repository: string) => {
		setRoot(repository);
		setBusy(false);
	};
	const selectTab = (key: string) => {
		setDiff(undefined);
		openRequest.current++;
		setBusy(false);
		setSelected(key);
		setError(undefined);
		setNotice(undefined);
	};
	const resolveConflict = (choice: "draft" | "disk") => {
		if (!current?.external) return;
		const disk = current.external;
		current.external = undefined;
		current.hash = disk.hash;
		current.base = disk.text;
		if (choice === "disk") {
			current.text = disk.text;
			current.model?.setValue(disk.text);
		}
		redraw((version) => version + 1);
		setError(undefined);
	};
	const toggleDirectory = (path: string) => {
		setExpanded((before) => {
			const next = new Set(before);
			if (next.has(path)) next.delete(path);
			else next.add(path);
			return next;
		});
		if (!entries[path]) void loadDirectory(path);
	};

	return (
		<section className="wp-code" aria-label="Code workspace" data-connected={world.connected}>
			<header className="wp-code-toolbar">
				<label>
					Repository{" "}
					<select aria-label="Code repository" value={root} onChange={(event) => switchRoot(event.target.value)}>
						<option value="">Choose a repository</option>
						{repositoryList.map((repository) => (
							<option key={repository} value={repository}>
								{repository}
							</option>
						))}
					</select>
				</label>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						if (manualRoot.trim()) {
							switchRoot(manualRoot.trim());
							setRoots((before) => [...new Set([...before, manualRoot.trim()])]);
							setManualRoot("");
						}
					}}
				>
					<input
						aria-label="Repository path"
						placeholder="Open a local repository path"
						value={manualRoot}
						onChange={(event) => setManualRoot(event.target.value)}
					/>
					<button type="submit" disabled={!manualRoot.trim()}>
						Open
					</button>
				</form>
				<button type="button" aria-pressed={showGit} onClick={() => setShowGit(!showGit)}>
					Git
				</button>
			</header>
			{changedElsewhere > 0 && (
				<div className="wp-code-notice">
					{changedElsewhere} unsaved {changedElsewhere === 1 ? "file is" : "files are"} kept in other repositories.
					Switch back to save.
				</div>
			)}
			{error && (
				<div className="wp-code-error" role="alert">
					{error}
				</div>
			)}
			{notice && (
				<div className="wp-code-notice" role="status">
					{notice}
				</div>
			)}
			<div className={`wp-code-panes ${showGit ? "with-git" : ""}`}>
				<aside className="wp-code-files" aria-label="Files">
					<div className="wp-code-pane-heading">
						<strong>Files</strong>
						<button
							type="button"
							disabled={!root}
							onClick={() => {
								setEntries({});
								void loadDirectory("");
								for (const path of expanded) void loadDirectory(path);
							}}
						>
							Refresh files
						</button>
					</div>
					{root ? (
						<FileTree
							entries={entries}
							expanded={expanded}
							selected={current?.path}
							onToggle={toggleDirectory}
							onOpen={(path) => {
								void openFile(path);
							}}
						/>
					) : (
						<p className="wp-code-empty">Choose a repository or enter its absolute path.</p>
					)}
				</aside>
				<main className="wp-code-editor-pane">
					<div className="wp-code-tabs" role="tablist" aria-label="Open files">
						{[...buffers.current.entries()]
							.filter(([, buffer]) => buffer.root === root)
							.map(([key, buffer]) => (
								<button
									type="button"
									role="tab"
									aria-selected={key === selected && !diff}
									key={key}
									title={buffer.path}
									onClick={() => selectTab(key)}
								>
									{buffer.path.split("/").at(-1)}
									{buffer.text !== buffer.base && (
										<span role="img" aria-label="Unsaved changes">
											{" "}
											●
										</span>
									)}
								</button>
							))}
					</div>
					{diff && (
						<section className="wp-code-diff" aria-label="Git diff">
							<header className="wp-code-diff-header">
								<div>
									<strong title={diff.path}>{diff.path}</strong>
									<span>{diff.staged ? "Staged changes" : "Working tree changes"} / Read-only</span>
								</div>
								<button type="button" onClick={() => setDiff(undefined)}>
									Close diff
								</button>
							</header>
							<GitDiffText text={diff.text} />
						</section>
					)}
					<div className="wp-code-edit-view" hidden={!!diff}>
						<div className="wp-code-editor-toolbar">
							<span title={current?.path}>{busy ? "Reading file..." : (current?.path ?? "No file selected")}</span>
							<button
								type="button"
								disabled={!current || saving}
								onClick={() => {
									if (current) void readBuffer(current).catch((reason) => setError(String(reason)));
								}}
							>
								Check disk
							</button>
							<button
								type="button"
								className="wp-code-save"
								disabled={!dirty || saving || !!current?.external}
								onClick={() => {
									void save();
								}}
							>
								{saving ? "Saving..." : "Save"}
							</button>
						</div>
						{current?.external && (
							<div className="wp-code-conflict" role="alert">
								<strong>File changed on disk. Your draft is kept; saving is blocked.</strong>
								<details>
									<summary>Review disk version</summary>
									<pre>{current.external.text}</pre>
								</details>
								<p>Saving will replace the disk version shown here.</p>
								<button type="button" onClick={() => resolveConflict("draft")}>
									Keep my draft
								</button>
								<button type="button" onClick={() => resolveConflict("disk")}>
									Discard draft and use disk version
								</button>
							</div>
						)}
						<div className="wp-code-editor-host">
							<div ref={container} className="wp-code-monaco" />
							{!current && (
								<div className="wp-code-editor-placeholder">
									{loaded ? "Select a text file to begin editing." : "Loading editor..."}
									<small>
										Changes stay local until you choose Save or press{" "}
										{navigator.platform.includes("Mac") ? "⌘S" : "Ctrl+S"}.
									</small>
								</div>
							)}
						</div>
					</div>
				</main>
				<aside className="wp-code-git" hidden={!showGit} aria-label="Repository changes">
					{root ? (
						<GitPane
							root={root}
							onDiff={setDiff}
							onOpenFile={(path) => {
								void openFile(path);
							}}
						/>
					) : (
						<p className="wp-code-empty">Select a repository to see Git changes.</p>
					)}
				</aside>
			</div>
		</section>
	);
}
