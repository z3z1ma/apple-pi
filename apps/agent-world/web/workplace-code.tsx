import type { editor } from "monaco-editor";
import { type KeyboardEvent, type MouseEvent, useCallback, useEffect, useRef, useState } from "react";
import type { WorkspaceEntry, WorkspaceWorktree } from "../src/workspace.js";
import type { WorldSnapshot } from "../src/world.js";
import type { FileReferenceTarget } from "./file-reference-paths.js";
import { useWorkplaceMenu } from "./workplace-context-menu.js";
import { GitDiffText, type GitDiffView, GitPane } from "./workplace-git.js";
import { Icon } from "./workplace-icon.js";
import { QuickOpen } from "./workplace-quick-open.js";
import { usePaneResize } from "./workplace-resize.js";
import { WorkplaceTerminal } from "./workplace-terminal.js";
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

function worktreeLabel(tree: WorkspaceWorktree) {
	return [
		tree.branch ?? "",
		tree.detached ? "Detached HEAD" : "",
		tree.bare ? "Bare repository" : "",
		tree.current ? "Current" : "",
		tree.locked !== undefined ? `Locked${tree.locked ? `: ${tree.locked}` : ""}` : "",
		tree.prunable !== undefined ? `Prunable${tree.prunable ? `: ${tree.prunable}` : ""}` : "",
		tree.path,
	]
		.filter(Boolean)
		.join(" - ");
}

function FileTree({
	repository,
	entries,
	expanded,
	selected,
	onToggle,
	onOpen,
	onCopy,
	depth = 0,
	path = "",
}: {
	repository: string;
	entries: Record<string, WorkspaceEntry[]>;
	expanded: Set<string>;
	selected?: string;
	onToggle(path: string): void;
	onOpen(path: string): void;
	onCopy(path: string): void;
	depth?: number;
	path?: string;
}) {
	const openMenu = useWorkplaceMenu();
	const menu = (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>, entry: WorkspaceEntry) => {
		openMenu(event, [
			...(entry.kind === "directory" ? [] : [{ label: "Open", onSelect: () => onOpen(entry.path) }]),
			{ label: "Copy relative path", onSelect: () => onCopy(entry.path) },
		]);
	};
	return (
		<ul className="wp-code-tree-list">
			{(entries[path] ?? []).map((entry) => (
				<li key={entry.path}>
					<button
						type="button"
						className={selected === entry.path ? "is-selected" : ""}
						style={{ paddingLeft: 8 + depth * 14 }}
						aria-expanded={entry.kind === "directory" ? expanded.has(entry.path) : undefined}
						aria-current={selected === entry.path ? "true" : undefined}
						title={`${repository}/${entry.path}`}
						onClick={() => (entry.kind === "directory" ? onToggle(entry.path) : onOpen(entry.path))}
						onContextMenu={(event) => menu(event, entry)}
						onKeyDown={(event) => menu(event, entry)}
					>
						<span className="wp-code-chevron" aria-hidden="true">
							{entry.kind === "directory" && (
								<Icon name={expanded.has(entry.path) ? "chevron-down" : "chevron-right"} />
							)}
						</span>
						<span className="wp-code-file-icon" aria-hidden="true">
							<Icon
								name={entry.kind === "directory" ? (expanded.has(entry.path) ? "folder-open" : "folder") : "file"}
							/>
						</span>
						<span className="wp-code-file-name">{entry.name}</span>
						{entry.kind === "symlink" && <small>link</small>}
					</button>
					{entry.kind === "directory" && expanded.has(entry.path) && (
						<FileTree
							repository={repository}
							entries={entries}
							expanded={expanded}
							selected={selected}
							onToggle={onToggle}
							onOpen={onOpen}
							onCopy={onCopy}
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
	onTerminalCountChange,
	fileRequest,
}: {
	world: WorldSnapshot;
	active: boolean;
	onDirtyChange?: (dirty: boolean) => void;
	onTerminalCountChange?: (count: number) => void;
	fileRequest?: FileReferenceTarget;
}) {
	const openMenu = useWorkplaceMenu();
	const tabButtons = useRef(new Map<string, HTMLButtonElement>());
	const filesPane = useRef<HTMLElement>(null);
	const [roots, setRoots] = useState<string[]>([]);
	const [root, setRoot] = useState("");
	const rootRef = useRef(root);
	rootRef.current = root;
	const [manualRoot, setManualRoot] = useState("");
	const [quickOpen, setQuickOpen] = useState(false);
	const [worktrees, setWorktrees] = useState<WorkspaceWorktree[]>([]);
	const [worktreeRoot, setWorktreeRoot] = useState("");
	const [worktreeError, setWorktreeError] = useState<string>();
	const [worktreeLoading, setWorktreeLoading] = useState(false);
	const [entries, setEntries] = useState<Record<string, WorkspaceEntry[]>>({});
	const [expanded, setExpanded] = useState(new Set<string>());
	const [selected, setSelected] = useState<string>();
	const selectedRef = useRef(selected);
	selectedRef.current = selected;
	const [error, setError] = useState<string>();
	const [notice, setNotice] = useState<string>();
	const [busy, setBusy] = useState(false);
	const [saving, setSaving] = useState(false);
	const [showGit, setShowGit] = useState(true);
	const panes = useRef<HTMLDivElement>(null);
	const files = usePaneResize({
		label: "Files width",
		variable: "--wp-files-width",
		axis: "x",
		direction: 1,
		min: 150,
		max: (): number => {
			const node = git.pane.current;
			const available = (panes.current?.clientWidth ?? 0) - 160 - 6;
			const side =
				showGit && node && getComputedStyle(node).gridColumnEnd !== "-1"
					? Math.min(node.offsetWidth + 6, Math.max(0, available - 150))
					: 0;
			return available - side;
		},
	});
	const git = usePaneResize({
		label: "Source control width",
		variable: "--wp-git-width",
		axis: "x",
		direction: -1,
		min: 180,
		max: () => {
			const available = (panes.current?.clientWidth ?? 0) - 160 - 12;
			return available - Math.min(filesPane.current?.offsetWidth ?? 0, Math.max(0, available - 180));
		},
		enabled: showGit,
	});
	const [diff, setDiff] = useState<GitDiffView>();
	const buffers = useRef(new Map<string, Buffer>());
	const [, redraw] = useState(0);
	const [loaded, setLoaded] = useState<MonacoModule>();
	const container = useRef<HTMLDivElement>(null);
	const instance = useRef<editor.IStandaloneCodeEditor | undefined>(undefined);
	const openRequest = useRef(0);
	const handledFileRequest = useRef<FileReferenceTarget | undefined>(undefined);
	const [reveal, setReveal] = useState<{ key: string; line: number; column: number }>();
	const revealed = useRef<typeof reveal>(undefined);
	const savingRef = useRef(false);
	const saveRef = useRef<() => void>(() => {});
	const current = selected ? buffers.current.get(selected) : undefined;
	const dirty = current !== undefined && current.text !== current.base;
	const repositoryList = [...new Set([...roots, root].filter(Boolean))];
	const openBuffers = [...buffers.current.entries()].filter(([, buffer]) => buffer.root === root);
	const changedElsewhere = [...buffers.current.values()].filter(
		(buffer) => buffer.root !== root && buffer.text !== buffer.base,
	).length;
	const retainedDirty = [...buffers.current.values()].some(
		(buffer) => buffer.text !== buffer.base || !!buffer.external,
	);
	useEffect(() => {
		onDirtyChange?.(retainedDirty);
	}, [retainedDirty, onDirtyChange]);
	const showQuickOpen = useCallback(() => {
		if (rootRef.current) setQuickOpen(true);
	}, []);
	useEffect(() => {
		if (!active) {
			setQuickOpen(false);
			return;
		}
		const open = (event: globalThis.KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "p") {
				event.preventDefault();
				event.stopPropagation();
				showQuickOpen();
			}
		};
		window.addEventListener("keydown", open, true);
		return () => window.removeEventListener("keydown", open, true);
	}, [active, showQuickOpen]);
	useEffect(() => {
		let live = true;
		setWorktrees([]);
		setWorktreeError(undefined);
		setWorktreeRoot("");
		setWorktreeLoading(!!root);
		if (!root) return;
		void (async () => {
			try {
				const result = await api.workspace.worktrees({ root });
				if (!live) return;
				if (!result.ok) {
					setWorktreeError(result.reason);
					return;
				}
				setWorktrees(result.worktrees);
				setWorktreeRoot(result.root);
			} catch (reason) {
				if (live) setWorktreeError(String(reason));
			} finally {
				if (live) setWorktreeLoading(false);
			}
		})();
		return () => {
			live = false;
		};
	}, [root]);

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
		if (active) {
			instance.current.layout();
			if (reveal && revealed.current !== reveal && reveal.key === selected) {
				const position = current.model.validatePosition({ lineNumber: reveal.line, column: reveal.column });
				instance.current.setPosition(position);
				instance.current.revealPositionInCenter(position);
				instance.current.focus();
				revealed.current = reveal;
			}
		}
	}, [current, loaded, active, reveal, selected]);

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
		setQuickOpen(false);
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
		if (baseHash !== buffer.hash || buffers.current.get(fileKey(buffer.root, buffer.path)) !== buffer) return;
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

	const openFile = useCallback(
		async (path: string) => {
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
				return true;
			}
			setBusy(true);
			try {
				const result = await api.workspace.readFile({ root: repository, path });
				if (request !== openRequest.current || repository !== rootRef.current) return false;
				if (!result.ok) {
					if ("nonTextFile" in result) {
						const opened = await api.openFile(result.nonTextFile, repository);
						if (request !== openRequest.current || repository !== rootRef.current) return false;
						if (opened.ok) setNotice("Sent to the system file handler.");
						else setError(opened.reason);
					} else setError(result.reason);
					return;
				}
				buffers.current.set(key, { root: repository, path, text: result.text, base: result.text, hash: result.hash });
				setSelected(key);
				return true;
			} catch (reason) {
				if (request === openRequest.current) setError(String(reason));
			} finally {
				if (request === openRequest.current) setBusy(false);
			}
		},
		[root],
	);

	useEffect(() => {
		if (!fileRequest || handledFileRequest.current === fileRequest) return;
		if (root !== fileRequest.root) {
			setRoot(fileRequest.root);
			return;
		}
		handledFileRequest.current = fileRequest;
		void openFile(fileRequest.path).then((opened) => {
			if (!opened || handledFileRequest.current !== fileRequest) return;
			setReveal({
				key: fileKey(fileRequest.root, fileRequest.path),
				line: fileRequest.line ?? 1,
				column: fileRequest.column ?? 1,
			});
		});
	}, [fileRequest, root, openFile]);

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
		setRoots((before) => [...new Set([...before, repository])]);
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
	const closeTabs = (keys: string[]) => {
		if (savingRef.current || root !== rootRef.current) return;
		const closing = new Set(keys.filter((key) => buffers.current.get(key)?.root === root));
		if (!closing.size) return;
		const unsaved = [...closing].flatMap((key) => {
			const buffer = buffers.current.get(key)!;
			return buffer.text !== buffer.base || buffer.external ? [buffer.path] : [];
		});
		if (
			unsaved.length &&
			!window.confirm(`Discard unsaved changes in:\n${unsaved.join("\n")}\n\nClosing these files does not save them.`)
		)
			return;
		const tabs = [...buffers.current.entries()].filter(([, buffer]) => buffer.root === root);
		const selectedKey = selectedRef.current;
		const remaining = tabs.filter(([key]) => !closing.has(key));
		const index = tabs.findIndex(([key]) => key === selectedKey);
		const next =
			selectedKey && !closing.has(selectedKey)
				? selectedKey
				: remaining[Math.min(Math.max(index, 0), remaining.length - 1)]?.[0];
		openRequest.current++;
		setBusy(false);
		if (selectedKey && closing.has(selectedKey)) {
			instance.current?.setModel(null);
			setDiff(undefined);
		}
		for (const key of closing) {
			const buffer = buffers.current.get(key)!;
			buffers.current.delete(key);
			buffer.listener?.dispose();
			buffer.model?.dispose();
		}
		setSelected(next);
		setError(undefined);
		setNotice(undefined);
		redraw((version) => version + 1);
		requestAnimationFrame(() => {
			if (filesPane.current?.getClientRects().length) (tabButtons.current.get(next ?? "") ?? filesPane.current).focus();
		});
	};
	const copyPath = async (path: string) => {
		try {
			await navigator.clipboard.writeText(path);
			setNotice(`Copied ${path}`);
		} catch (reason) {
			setError(`Could not copy path: ${String(reason)}`);
		}
	};
	const tabMenu = (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>, key: string) => {
		const buffer = buffers.current.get(key);
		if (!buffer) return;
		openMenu(event, [
			{ label: "Close", onSelect: () => closeTabs([key]), disabled: saving },
			{
				label: "Close others",
				onSelect: () => closeTabs([...buffers.current.keys()].filter((other) => other !== key)),
				disabled: saving || openBuffers.length < 2,
			},
			{ label: "Close all", onSelect: () => closeTabs([...buffers.current.keys()]), disabled: saving },
			{
				label: "Copy relative path",
				onSelect: () => {
					void copyPath(buffer.path);
				},
			},
		]);
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
				<select
					className="wp-code-worktrees"
					aria-label="Linked worktree"
					title={worktreeError ?? (worktreeRoot ? `Linked worktrees of ${worktreeRoot}` : "Linked worktrees")}
					value={
						worktrees.find((tree) => tree.path === root)?.path ?? worktrees.find((tree) => tree.current)?.path ?? ""
					}
					disabled={worktreeLoading || !worktrees.length}
					onChange={(event) => {
						const tree = worktrees.find((entry) => entry.path === event.target.value);
						if (tree && !tree.bare && tree.prunable === undefined) switchRoot(tree.path);
					}}
				>
					{!worktrees.length && (
						<option value="">
							{worktreeLoading
								? "Discovering worktrees..."
								: worktreeError
									? "Worktrees unavailable"
									: "No linked worktrees"}
						</option>
					)}
					{worktrees.map((tree) => (
						<option
							key={tree.path}
							value={tree.path}
							disabled={tree.bare || tree.prunable !== undefined}
							title={worktreeLabel(tree)}
						>
							{worktreeLabel(tree)}
						</option>
					))}
				</select>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						if (manualRoot.trim()) {
							switchRoot(manualRoot.trim());
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
			<div
				ref={panes}
				style={{ ...files.style, ...git.style }}
				className={`wp-code-panes ${showGit ? "with-git" : ""}`}
			>
				<aside
					className="wp-code-files"
					aria-label="Files"
					tabIndex={-1}
					ref={(node) => {
						filesPane.current = node;
						files.ref(node);
					}}
				>
					<div className="wp-code-pane-heading">
						<strong>Files</strong>
						<div className="wp-code-file-actions">
							<button
								type="button"
								className="wp-icon-button"
								aria-label="Quick open file"
								title="Quick open file (Cmd/Ctrl+P)"
								disabled={!root}
								onClick={showQuickOpen}
							>
								<Icon name="search" />
							</button>
							<button
								type="button"
								className="wp-icon-button"
								aria-label="Refresh files"
								title="Refresh files"
								disabled={!root}
								onClick={() => {
									setEntries({});
									void loadDirectory("");
									for (const path of expanded) void loadDirectory(path);
								}}
							>
								<Icon name="refresh" />
							</button>
						</div>
					</div>
					{root ? (
						<FileTree
							repository={root}
							entries={entries}
							expanded={expanded}
							selected={current?.path}
							onToggle={toggleDirectory}
							onCopy={(path) => {
								void copyPath(path);
							}}
							onOpen={(path) => {
								void openFile(path);
							}}
						/>
					) : (
						<p className="wp-code-empty">Choose a repository or enter its absolute path.</p>
					)}
				</aside>
				{files.separator}
				<main className="wp-code-editor-pane">
					<div className="wp-code-tabs" role="tablist" aria-label="Open files">
						{openBuffers.map(([key, buffer]) => (
							<div
								className={`wp-code-tab ${key === selected && !diff ? "is-selected" : ""}`}
								key={key}
								role="presentation"
							>
								<button
									type="button"
									role="tab"
									aria-selected={key === selected && !diff}
									ref={(button) => {
										if (button) tabButtons.current.set(key, button);
										else tabButtons.current.delete(key);
									}}
									title={buffer.path}
									onClick={() => selectTab(key)}
									onContextMenu={(event) => tabMenu(event, key)}
									onKeyDown={(event) => tabMenu(event, key)}
								>
									{buffer.path.split("/").at(-1)}
									{buffer.text !== buffer.base && (
										<span role="img" aria-label="Unsaved changes">
											{" "}
											●
										</span>
									)}
								</button>
								<button
									type="button"
									className="wp-code-tab-close"
									aria-label={`Close ${buffer.path}`}
									title={`Close ${buffer.path}`}
									disabled={saving}
									onClick={() => closeTabs([key])}
									onContextMenu={(event) => tabMenu(event, key)}
									onKeyDown={(event) => tabMenu(event, key)}
								>
									<Icon name="close" />
								</button>
							</div>
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
								className="wp-icon-button"
								aria-label="Check for file changes"
								title="Check for file changes on disk"
								disabled={!current || saving}
								onClick={() => {
									if (current) void readBuffer(current).catch((reason) => setError(String(reason)));
								}}
							>
								<Icon name="refresh" />
							</button>
							<button
								type="button"
								className="wp-icon-button wp-code-save"
								aria-label={saving ? "Saving" : "Save"}
								title="Save (Cmd/Ctrl+S)"
								disabled={!dirty || saving || !!current?.external}
								onClick={() => {
									void save();
								}}
							>
								<Icon name="save" />
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
					<WorkplaceTerminal root={root} active={active} onLiveCountChange={onTerminalCountChange} />
				</main>
				{git.separator}
				<aside ref={git.ref} className="wp-code-git" hidden={!showGit} aria-label="Repository changes">
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
			{quickOpen && (
				<QuickOpen
					root={root}
					onClose={() => setQuickOpen(false)}
					onOpen={(path) => {
						setQuickOpen(false);
						void openFile(path).then(() =>
							requestAnimationFrame(() => {
								if (
									selectedRef.current === fileKey(rootRef.current, path) &&
									filesPane.current?.getClientRects().length
								)
									instance.current?.focus();
							}),
						);
					}}
				/>
			)}
		</section>
	);
}
