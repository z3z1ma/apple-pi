import {
	type KeyboardEvent,
	type MouseEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { GitAction, GitChange, GitCommit, GitCommitDetail, GitOverview, GitRef } from "../src/git.js";
import type { WorkspaceWorktree } from "../src/workspace.js";
import { useWorkplaceMenu } from "./workplace-context-menu.js";
import { WorkplaceDialog } from "./workplace-dialog.js";
import { Select } from "./workplace-fields.js";
import { type DiffView, GitDiff } from "./workplace-git-diff.js";
import { laneLayout } from "./workplace-git-graph.js";
import { Icon } from "./workplace-icon.js";
import { chooseRepository as setRoot, useRepository } from "./workplace-repository.js";
import { usePaneResize } from "./workplace-resize.js";
import "./workplace-git.css";

const PAGE = 300;
const ROW = 30;
const LANE = 14;
const workspaceApi = () => window.agentWorkplace.workspace;
const gitApi = () => window.agentWorkplace.git;

type Selection = { kind: "changes" } | { kind: "commit"; sha: string };
type Toast = { kind: "done" | "failed"; title: string; text: string };
type Ask =
	| { kind: "confirm"; root: string; title: string; body: ReactNode; confirm: string; danger?: boolean; run(): void }
	| {
			kind: "name";
			root: string;
			title: string;
			label: string;
			value: string;
			confirm: string;
			run(value: string): void;
	  };

export function repositoryLabel(path: string) {
	return path.split("/").filter(Boolean).at(-1) ?? path;
}

export function relativeTime(seconds: number, now = Date.now()) {
	const minutes = Math.round((now / 1000 - seconds) / 60);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.round(hours / 24);
	if (days < 30) return `${days}d ago`;
	return new Date(seconds * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function initials(name: string) {
	return (
		name
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((part) => part[0]?.toUpperCase())
			.join("") || "?"
	);
}

function hue(text: string) {
	let value = 0;
	for (const char of text) value = (value * 31 + char.charCodeAt(0)) % 360;
	return value;
}

type Badge = { label: string; kind: "head" | "local" | "remote" | "tag" };

export function refBadges(refs: string[]): Badge[] {
	return refs.flatMap((ref): Badge[] => {
		if (ref.startsWith("HEAD -> ")) return [{ label: ref.slice(8), kind: "head" }];
		if (ref === "HEAD") return [{ label: "HEAD", kind: "head" }];
		if (ref.startsWith("tag: ")) return [{ label: ref.slice(5), kind: "tag" }];
		if (ref.endsWith("/HEAD")) return [];
		return [{ label: ref, kind: ref.includes("/") && !ref.startsWith("refs/") ? "remote" : "local" }];
	});
}

function changeLabel(change: GitChange, staged: boolean) {
	const code = staged ? change.index : change.worktree;
	return {
		M: "Modified",
		A: "Added",
		D: "Deleted",
		R: "Renamed",
		C: "Copied",
		U: "Conflicted",
		T: "Type changed",
		"?": "Untracked",
	}[code];
}

function GraphCell({ row, color }: { row: ReturnType<typeof laneLayout>[number]; color(lane: number): string }) {
	const x = (lane: number) => 10 + lane * LANE;
	const mid = ROW / 2;
	const curve = (from: number, to: number, down: boolean) =>
		down
			? `M${x(from)} ${mid} C${x(from)} ${ROW - 4} ${x(to)} ${mid + 4} ${x(to)} ${ROW}`
			: `M${x(from)} 0 C${x(from)} ${mid - 4} ${x(to)} 4 ${x(to)} ${mid}`;
	return (
		<>
			{row.through.map((lane) => (
				<line key={`t${lane}`} x1={x(lane)} y1={0} x2={x(lane)} y2={ROW} stroke={color(lane)} />
			))}
			{row.incoming.map((lane) => (
				<path key={`i${lane}`} d={curve(lane, row.lane, false)} stroke={color(lane)} fill="none" />
			))}
			{row.outgoing.map((lane) => (
				<path
					key={`o${lane}`}
					d={curve(row.lane, lane, true)}
					stroke={color(lane === row.lane ? row.lane : lane)}
					fill="none"
				/>
			))}
		</>
	);
}

const LANE_COLORS = ["#7c5ce6", "#1fa37a", "#e0773b", "#2f8fd8", "#d64f8f", "#b8a12c", "#4fb3bf", "#9b6b4a"];
const laneColor = (lane: number) => LANE_COLORS[lane % LANE_COLORS.length];

function ChangeList({
	title,
	changes,
	staged,
	onOpen,
	onStage,
	onDiscard,
	onAll,
	allLabel,
	selected,
}: {
	title: string;
	changes: GitChange[];
	staged: boolean;
	onOpen(change: GitChange): void;
	onStage(paths: string[]): void;
	onDiscard?(paths: string[]): void;
	onAll(): void;
	allLabel: string;
	selected?: string;
}) {
	return (
		<section className="wp-gitx-changes" aria-label={title}>
			<header>
				<h3>
					{title} <span>{changes.length}</span>
				</h3>
				{changes.length > 0 && (
					<button type="button" className="wp-gitx-text-button" onClick={onAll}>
						{allLabel}
					</button>
				)}
			</header>
			{changes.length === 0 ? (
				<p className="wp-gitx-quiet">{staged ? "Nothing staged yet." : "No unstaged changes."}</p>
			) : (
				<ul>
					{changes.map((change) => {
						const code = staged ? change.index : change.worktree;
						const key = `${staged}:${change.path}`;
						return (
							<li key={change.path} data-selected={selected === key}>
								<button
									type="button"
									className="wp-gitx-file"
									title={change.previousPath ? `${change.previousPath} \u2192 ${change.path}` : change.path}
									aria-label={`View ${staged ? "staged" : "unstaged"} diff: ${change.path}`}
									onClick={() => onOpen(change)}
								>
									<span
										className={`wp-gitx-code is-${code === "?" ? "untracked" : code.toLowerCase()}`}
										title={changeLabel(change, staged)}
									>
										{code === "?" ? "U" : code}
									</span>
									<span className="wp-gitx-file-name">{change.path.split("/").at(-1)}</span>
									{change.path.includes("/") && (
										<span className="wp-gitx-file-dir">{change.path.slice(0, change.path.lastIndexOf("/"))}</span>
									)}
								</button>
								<span className="wp-gitx-row-actions">
									{onDiscard && (
										<button
											type="button"
											className="wp-gitx-mini"
											aria-label={`Discard changes: ${change.path}`}
											title="Discard changes"
											onClick={() => onDiscard([change.path])}
										>
											<Icon name="undo" />
										</button>
									)}
									<button
										type="button"
										className="wp-gitx-mini"
										aria-label={`${staged ? "Unstage" : "Stage"}: ${change.path}`}
										title={staged ? "Unstage" : "Stage"}
										onClick={() => onStage([change.path])}
									>
										<Icon name={staged ? "minus" : "plus"} />
									</button>
								</span>
							</li>
						);
					})}
				</ul>
			)}
		</section>
	);
}

function Section({
	title,
	count,
	icon,
	children,
	open: initiallyOpen = true,
}: {
	title: string;
	count: number;
	icon: Parameters<typeof Icon>[0]["name"];
	children: ReactNode;
	open?: boolean;
}) {
	const [open, setOpen] = useState(initiallyOpen);
	return (
		<section className="wp-gitx-section">
			<button type="button" className="wp-gitx-section-head" aria-expanded={open} onClick={() => setOpen(!open)}>
				<Icon name={open ? "chevron-down" : "chevron-right"} />
				<Icon name={icon} />
				<span>{title}</span>
				<small>{count}</small>
			</button>
			{open && children}
		</section>
	);
}

type Draft = { summary: string; description: string; amend: boolean };
const EMPTY_DRAFT: Draft = { summary: "", description: "", amend: false };

function CommitForm({
	draft,
	onDraft,
	stagedCount,
	branch,
	busy,
	onCommit,
}: {
	draft: Draft;
	onDraft(draft: Draft): void;
	stagedCount: number;
	branch?: string | null;
	busy: boolean;
	onCommit(): void;
}) {
	const files = `${stagedCount} ${stagedCount === 1 ? "file" : "files"}`;
	const label = draft.amend
		? "Amend commit"
		: stagedCount
			? `Commit ${files}${branch ? ` to ${branch}` : ""}`
			: "Stage files to commit";
	return (
		<form
			className="wp-gitx-commit"
			onSubmit={(event) => {
				event.preventDefault();
				onCommit();
			}}
		>
			<div className="wp-gitx-summary">
				<input
					aria-label="Commit summary"
					placeholder="Summary"
					value={draft.summary}
					onChange={(event) => onDraft({ ...draft, summary: event.target.value })}
				/>
				<small data-long={draft.summary.length > 72 || undefined}>{72 - draft.summary.length}</small>
			</div>
			<textarea
				aria-label="Commit description"
				placeholder="Description"
				rows={3}
				value={draft.description}
				onChange={(event) => onDraft({ ...draft, description: event.target.value })}
				onKeyDown={(event) => {
					if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
						event.preventDefault();
						onCommit();
					}
				}}
			/>
			<label className="wp-gitx-amend">
				<input
					type="checkbox"
					checked={draft.amend}
					onChange={(event) => onDraft({ ...draft, amend: event.target.checked })}
				/>
				Amend previous commit
			</label>
			<button
				type="submit"
				className="wp-gitx-commit-button"
				disabled={busy || (!draft.amend && (!stagedCount || !draft.summary.trim()))}
			>
				<Icon name="commit" />
				{label}
			</button>
		</form>
	);
}

function CommitDetail({
	detail,
	selectedFile,
	onJump,
	onOpenFile,
}: {
	detail: GitCommitDetail;
	selectedFile?: string;
	onJump(sha: string): void;
	onOpenFile(file: GitCommitDetail["files"][number]): void;
}) {
	const body = detail.body.split("\n").slice(1).join("\n").trim();
	return (
		<>
			<header className="wp-gitx-panel-head">
				<h2>Commit</h2>
				<button
					type="button"
					className="wp-gitx-sha-button"
					title="Copy SHA"
					onClick={() => void navigator.clipboard.writeText(detail.sha)}
				>
					{detail.sha.slice(0, 10)}
					<Icon name="copy" />
				</button>
			</header>
			<div className="wp-gitx-panel-scroll">
				<div className="wp-gitx-commit-detail">
					<h3>{detail.subject}</h3>
					{body && <p className="wp-gitx-body-text">{body}</p>}
					<div className="wp-gitx-who">
						<span className="wp-gitx-avatar" style={{ "--wp-gitx-hue": hue(detail.email) } as React.CSSProperties}>
							{initials(detail.author)}
						</span>
						<div>
							<strong>{detail.author}</strong>
							<span>
								{detail.email} · {new Date(detail.date * 1000).toLocaleString()}
							</span>
						</div>
					</div>
					{detail.parents.length > 0 && (
						<p className="wp-gitx-parents">
							{detail.parents.length > 1 ? "Parents" : "Parent"}{" "}
							{detail.parents.map((parent) => (
								<button key={parent} type="button" onClick={() => onJump(parent)}>
									{parent.slice(0, 7)}
								</button>
							))}
						</p>
					)}
				</div>
				<section className="wp-gitx-changes" aria-label="Changed files">
					<header>
						<h3>
							Changed files <span>{detail.files.length}</span>
						</h3>
					</header>
					<ul>
						{detail.files.map((file) => (
							<li key={file.path} data-selected={selectedFile === `${detail.sha}:${file.path}`}>
								<button
									type="button"
									className="wp-gitx-file"
									title={file.previousPath ? `${file.previousPath} \u2192 ${file.path}` : file.path}
									onClick={() => onOpenFile(file)}
								>
									<span className={`wp-gitx-code is-${file.status.toLowerCase()}`}>{file.status}</span>
									<span className="wp-gitx-file-name">{file.path.split("/").at(-1)}</span>
									{file.path.includes("/") && (
										<span className="wp-gitx-file-dir">{file.path.slice(0, file.path.lastIndexOf("/"))}</span>
									)}
								</button>
							</li>
						))}
					</ul>
				</section>
			</div>
		</>
	);
}

function BadgeIcon({ kind }: { kind: Badge["kind"] }) {
	if (kind === "tag") return <Icon name="tag" />;
	if (kind === "remote") return <Icon name="cloud" />;
	return <Icon name="branch" />;
}

function CommitGraph({
	commits,
	head,
	changeCount,
	selection,
	onSelect,
	onMenu,
	children,
}: {
	commits: GitCommit[];
	head?: string | null;
	changeCount: number;
	selection: Selection;
	onSelect(selection: Selection): void;
	onMenu(event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>, commit: GitCommit): void;
	children: ReactNode;
}) {
	const rows = useMemo(() => laneLayout(commits), [commits]);
	const graphWidth = Math.max(1, ...rows.map((row) => row.width)) * LANE + 8;
	const headIndex = commits.findIndex((commit) => commit.sha === head);
	const headLane = headIndex >= 0 ? rows[headIndex].lane : 0;
	return (
		<div className="wp-gitx-graph" style={{ "--wp-gitx-graph": `${graphWidth}px` } as React.CSSProperties}>
			<div role="listbox" aria-label="Commit graph">
				{changeCount > 0 && (
					<div
						role="option"
						className="wp-gitx-row is-wip"
						aria-selected={selection.kind === "changes"}
						tabIndex={0}
						onClick={() => onSelect({ kind: "changes" })}
						onKeyDown={(event) => event.key === "Enter" && onSelect({ kind: "changes" })}
					>
						<svg className="wp-gitx-lanes" width={graphWidth} height={ROW} aria-hidden="true">
							{headIndex >= 0 && (
								<line
									x1={10 + headLane * LANE}
									y1={ROW / 2}
									x2={10 + headLane * LANE}
									y2={ROW}
									stroke={laneColor(headLane)}
									strokeDasharray="3 3"
								/>
							)}
							<circle cx={10 + headLane * LANE} cy={ROW / 2} r={5} className="wp-gitx-wip-node" />
						</svg>
						<span className="wp-gitx-subject">
							<em>Working changes</em>
							<span className="wp-gitx-wip-count">
								{changeCount} {changeCount === 1 ? "file" : "files"}
							</span>
						</span>
						<span />
						<span />
						<span />
					</div>
				)}
				{commits.map((commit, index) => {
					const row = rows[index];
					const isHead = commit.sha === head;
					const merge = commit.parents.length > 1;
					const select = () => onSelect({ kind: "commit", sha: commit.sha });
					return (
						<div
							key={commit.sha}
							role="option"
							data-sha={commit.sha}
							className={`wp-gitx-row ${merge ? "is-merge" : ""}`}
							aria-selected={selection.kind === "commit" && selection.sha === commit.sha}
							tabIndex={0}
							onClick={select}
							onKeyDown={(event) => (event.key === "Enter" ? select() : onMenu(event, commit))}
							onContextMenu={(event) => onMenu(event, commit)}
						>
							<svg className="wp-gitx-lanes" width={graphWidth} height={ROW} aria-hidden="true">
								{index === 0 && changeCount > 0 && isHead && (
									<line
										x1={10 + row.lane * LANE}
										y1={0}
										x2={10 + row.lane * LANE}
										y2={ROW / 2}
										stroke={laneColor(row.lane)}
										strokeDasharray="3 3"
									/>
								)}
								<GraphCell row={row} color={laneColor} />
								<circle
									cx={10 + row.lane * LANE}
									cy={ROW / 2}
									r={isHead ? 6 : merge ? 3.5 : 4.5}
									fill={isHead ? "var(--wp-panel)" : laneColor(row.lane)}
									stroke={laneColor(row.lane)}
									strokeWidth={isHead ? 3 : 1.5}
								/>
							</svg>
							<span className="wp-gitx-subject">
								{refBadges(commit.refs).map((badge) => (
									<span key={badge.label} className={`wp-gitx-badge is-${badge.kind}`}>
										<BadgeIcon kind={badge.kind} />
										{badge.label}
									</span>
								))}
								<span className="wp-gitx-message">{commit.subject}</span>
							</span>
							<span className="wp-gitx-author" title={`${commit.author} <${commit.email}>`}>
								<span className="wp-gitx-avatar" style={{ "--wp-gitx-hue": hue(commit.email) } as React.CSSProperties}>
									{initials(commit.author)}
								</span>
								<span>{commit.author}</span>
							</span>
							<span className="wp-gitx-date" title={new Date(commit.date * 1000).toLocaleString()}>
								{relativeTime(commit.date)}
							</span>
							<span className="wp-gitx-sha">{commit.sha.slice(0, 7)}</span>
						</div>
					);
				})}
			</div>
			{children}
		</div>
	);
}

export function WorkplaceGit({ active }: { active: boolean }) {
	const openMenu = useWorkplaceMenu();
	const [roots, setRoots] = useState<string[]>([]);
	const root = useRepository();
	const [manualRoot, setManualRoot] = useState("");
	const [worktrees, setWorktrees] = useState<WorkspaceWorktree[]>([]);
	const [overview, setOverview] = useState<GitOverview>();
	const [commits, setCommits] = useState<GitCommit[]>([]);
	const [complete, setComplete] = useState(false);
	const [selection, setSelection] = useState<Selection>({ kind: "changes" });
	const [detail, setDetail] = useState<GitCommitDetail>();
	const [diff, setDiff] = useState<DiffView>();
	const [selectedFile, setSelectedFile] = useState<string>();
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string>();
	const [busy, setBusy] = useState<string>();
	const [toast, setToast] = useState<Toast>();
	const [ask, setAsk] = useState<Ask>();
	const [askValue, setAskValue] = useState("");
	const [filter, setFilter] = useState("");
	const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
	const rootRef = useRef(root);
	rootRef.current = root;
	const body = useRef<HTMLDivElement>(null);
	const sidebar = usePaneResize({
		label: "Branches width",
		variable: "--wp-gitx-sidebar",
		axis: "x",
		direction: 1,
		min: 180,
		max: () => (body.current?.clientWidth ?? 0) - 640,
	});
	const panel = usePaneResize({
		label: "Details width",
		variable: "--wp-gitx-panel",
		axis: "x",
		direction: -1,
		min: 280,
		max: () => (body.current?.clientWidth ?? 0) - 560,
	});

	useEffect(() => {
		void workspaceApi()
			.repositories()
			.then((result) => {
				if (!result.ok) return;
				setRoots(result.roots);
				if (!rootRef.current && result.roots[0]) setRoot(result.roots[0]);
			});
	}, []);

	const refresh = useCallback(async () => {
		const at = rootRef.current;
		if (!at) return;
		setLoading(true);
		const [info, log] = await Promise.all([
			gitApi().overview({ root: at }),
			gitApi().log({ root: at, skip: 0, limit: PAGE }),
		]);
		if (rootRef.current !== at) return;
		setLoading(false);
		if (!info.ok) {
			setError(info.reason);
			setOverview(undefined);
			setCommits([]);
			return;
		}
		setError(undefined);
		setOverview(info.overview);
		if (log.ok) {
			setCommits(log.commits);
			setComplete(log.commits.length < PAGE);
		}
	}, []);

	useEffect(() => {
		if (!root) return;
		setOverview(undefined);
		setCommits([]);
		setDetail(undefined);
		setDiff(undefined);
		setSelection({ kind: "changes" });
		void refresh();
		void workspaceApi()
			.worktrees({ root })
			.then((result) => setWorktrees(result.ok ? result.worktrees : []));
	}, [root, refresh]);

	useEffect(() => {
		if (!active || !root) return;
		void refresh();
		const focus = () => void refresh();
		window.addEventListener("focus", focus);
		return () => window.removeEventListener("focus", focus);
	}, [active, root, refresh]);

	useEffect(() => {
		if (selection.kind !== "commit") {
			setDetail(undefined);
			return;
		}
		let live = true;
		void gitApi()
			.show({ root, sha: selection.sha })
			.then((result) => {
				if (live && result.ok) setDetail(result.commit);
			});
		return () => {
			live = false;
		};
	}, [root, selection]);

	useEffect(() => {
		if (!toast || toast.kind === "failed") return;
		const timer = setTimeout(() => setToast(undefined), 4000);
		return () => clearTimeout(timer);
	}, [toast]);

	const run = useCallback(
		async (label: string, action: GitAction, after?: () => void) => {
			setBusy(label);
			const result = await gitApi().run({ root, action });
			setBusy(undefined);
			if (result.ok) {
				setToast({ kind: "done", title: label, text: result.output });
				after?.();
			} else setToast({ kind: "failed", title: `${label} failed`, text: result.reason });
			await refresh();
			return result.ok;
		},
		[root, refresh],
	);

	const loadMore = async () => {
		const result = await gitApi().log({ root, skip: commits.length, limit: PAGE });
		if (!result.ok) return;
		setCommits((before) => [...before, ...result.commits]);
		setComplete(result.commits.length < PAGE);
	};

	const changes = overview?.changes ?? [];
	const staged = changes.filter((change) => ![" ", "?", "!"].includes(change.index));
	const unstaged = changes.filter((change) => change.worktree !== " " && change.worktree !== "!");
	const branch = overview?.branch;
	const refs = overview?.refs ?? [];
	const matches = (name: string) => !filter || name.toLowerCase().includes(filter.toLowerCase());
	const locals = refs.filter((ref) => ref.kind === "local" && matches(ref.name));
	const remotes = refs.filter((ref) => ref.kind === "remote" && matches(ref.name));
	const tags = refs.filter((ref) => ref.kind === "tag" && matches(ref.name));
	const remoteNames = [...new Set(remotes.map((ref) => ref.name.split("/")[0]))];
	const repositoryList = [...new Set([...roots, root].filter(Boolean))];

	const openChange = async (change: GitChange, isStaged: boolean) => {
		setSelectedFile(`${isStaged}:${change.path}`);
		const result = await gitApi().diff({ root, path: change.path, staged: isStaged });
		if (result.ok)
			setDiff({
				title: change.path,
				detail: `${isStaged ? "Staged" : "Unstaged"} · ${changeLabel(change, isStaged)}`,
				text: result.text,
			});
		else setToast({ kind: "failed", title: "Diff failed", text: result.reason });
	};
	const openCommitFile = async (sha: string, path: string, status: string) => {
		setSelectedFile(`${sha}:${path}`);
		const result = await gitApi().diff({ root, path, commit: sha });
		if (result.ok)
			setDiff({
				title: path,
				detail: `${sha.slice(0, 7)} · ${{ M: "Modified", A: "Added", D: "Deleted", R: "Renamed", C: "Copied", T: "Type changed" }[status] ?? status}`,
				text: result.text,
			});
		else setToast({ kind: "failed", title: "Diff failed", text: result.reason });
	};

	const confirm = (title: string, bodyText: ReactNode, label: string, action: () => void, danger = true) =>
		setAsk({ kind: "confirm", root, title, body: bodyText, confirm: label, danger, run: action });
	const askName = (
		title: string,
		label: string,
		value: string,
		confirmLabel: string,
		action: (name: string) => void,
	) => {
		setAskValue(value);
		setAsk({ kind: "name", root, title, label, value, confirm: confirmLabel, run: action });
	};
	const newBranch = (from: string, fromLabel: string) =>
		askName(
			`New branch from ${fromLabel}`,
			"Branch name",
			"",
			"Create and check out",
			(name) => void run(`Created ${name}`, { kind: "createBranch", name, from, checkout: true }),
		);
	const discard = (paths: string[]) =>
		confirm(
			paths.length === 1 ? `Discard changes to ${paths[0]}?` : `Discard ${paths.length} files' changes?`,
			"Unstaged and staged edits are lost; new untracked files are deleted. This cannot be undone.",
			"Discard",
			() => void run("Discarded changes", { kind: "discard", paths }),
		);

	const commitMenu = (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>, commit: GitCommit) =>
		openMenu(event, [
			{
				label: "Check out this commit (detached)",
				onSelect: () => void run("Checked out commit", { kind: "checkoutCommit", sha: commit.sha }),
			},
			{ label: "Create branch here\u2026", onSelect: () => newBranch(commit.sha, commit.sha.slice(0, 7)) },
			{
				label: "Create tag here\u2026",
				onSelect: () =>
					askName(
						`Tag ${commit.sha.slice(0, 7)}`,
						"Tag name",
						"",
						"Create tag",
						(name) => void run(`Tagged ${name}`, { kind: "createTag", name, sha: commit.sha }),
					),
			},
			{
				label: "Cherry-pick onto current branch",
				onSelect: () => void run("Cherry-picked", { kind: "cherryPick", sha: commit.sha }),
			},
			{ label: "Revert commit", onSelect: () => void run("Reverted", { kind: "revert", sha: commit.sha }) },
			{
				label: `Reset ${branch ?? "HEAD"} here: soft`,
				onSelect: () => void run("Reset (soft)", { kind: "reset", sha: commit.sha, mode: "soft" }),
			},
			{
				label: `Reset ${branch ?? "HEAD"} here: mixed`,
				onSelect: () => void run("Reset (mixed)", { kind: "reset", sha: commit.sha, mode: "mixed" }),
			},
			{
				label: `Reset ${branch ?? "HEAD"} here: hard\u2026`,
				onSelect: () =>
					confirm(
						`Hard reset ${branch ?? "HEAD"} to ${commit.sha.slice(0, 7)}?`,
						"Every uncommitted change is lost and later commits leave this branch. This cannot be undone.",
						"Hard reset",
						() => void run("Reset (hard)", { kind: "reset", sha: commit.sha, mode: "hard" }),
					),
			},
			{ label: "Copy commit SHA", onSelect: () => void navigator.clipboard.writeText(commit.sha) },
		]);

	const branchMenu = (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>, ref: GitRef) =>
		openMenu(event, [
			{
				label: `Check out ${ref.name}`,
				disabled: ref.current,
				onSelect: () => void run(`Checked out ${ref.name}`, { kind: "checkout", ref: ref.name }),
			},
			{
				label: `Merge ${ref.name} into ${branch ?? "HEAD"}`,
				disabled: ref.current,
				onSelect: () => void run(`Merged ${ref.name}`, { kind: "merge", ref: ref.name }),
			},
			{
				label: `Rebase ${branch ?? "HEAD"} onto ${ref.name}`,
				disabled: ref.current,
				onSelect: () => void run(`Rebased onto ${ref.name}`, { kind: "rebase", onto: ref.name }),
			},
			{ label: `New branch from ${ref.name}\u2026`, onSelect: () => newBranch(ref.name, ref.name) },
			...(ref.kind === "local"
				? [
						{
							label: `Delete ${ref.name}\u2026`,
							disabled: ref.current,
							onSelect: () =>
								confirm(
									`Delete branch ${ref.name}?`,
									"Git refuses if it is not merged; you can then force it.",
									"Delete",
									async () => {
										const deleted = await run(`Deleted ${ref.name}`, {
											kind: "deleteBranch",
											name: ref.name,
											force: false,
										});
										if (!deleted)
											confirm(
												`Force delete ${ref.name}?`,
												"It has commits that are not merged anywhere else. They become unreachable.",
												"Force delete",
												() => void run(`Deleted ${ref.name}`, { kind: "deleteBranch", name: ref.name, force: true }),
											);
									},
								),
						},
					]
				: []),
			...(ref.kind === "tag"
				? [
						{
							label: `Delete tag ${ref.name}`,
							onSelect: () => void run(`Deleted tag ${ref.name}`, { kind: "deleteTag", name: ref.name }),
						},
					]
				: []),
			{ label: "Copy name", onSelect: () => void navigator.clipboard.writeText(ref.name) },
		]);

	const jumpTo = (sha: string) => {
		setDiff(undefined);
		setSelection({ kind: "commit", sha });
		requestAnimationFrame(() => document.querySelector(`[data-sha="${sha}"]`)?.scrollIntoView({ block: "nearest" }));
	};

	const commitNow = () => {
		const summary = draft.summary.trim();
		const description = draft.description.trim();
		const message = description ? `${summary}\n\n${description}` : summary;
		if (!message && !draft.amend) return;
		void run(draft.amend ? "Amended commit" : "Committed", { kind: "commit", message, amend: draft.amend }, () =>
			setDraft(EMPTY_DRAFT),
		);
	};

	const switchRoot = (next: string) => {
		setRoots((before) => [...new Set([...before, next])]);
		setRoot(next);
	};

	const state = overview?.state ?? "clean";
	return (
		<section className="wp-gitx" aria-label="Git" data-busy={busy ? "true" : undefined}>
			<header className="wp-gitx-toolbar">
				<div className="wp-gitx-where">
					<Select
						label="Git repository"
						value={root}
						placeholder="Choose a repository"
						options={repositoryList.map((path) => ({ value: path, label: repositoryLabel(path), detail: path }))}
						onChange={switchRoot}
					/>
					<Select
						label="Worktree"
						value={worktrees.find((tree) => tree.path === root)?.path ?? ""}
						placeholder={worktrees.length > 1 ? "Worktrees" : "No linked worktrees"}
						disabled={worktrees.length < 2}
						options={worktrees.map((tree) => ({
							value: tree.path,
							label: tree.branch ?? (tree.detached ? "Detached HEAD" : repositoryLabel(tree.path)),
							detail: tree.path,
							disabled: tree.bare || tree.prunable !== undefined,
						}))}
						onChange={switchRoot}
					/>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							if (manualRoot.trim()) switchRoot(manualRoot.trim());
							setManualRoot("");
						}}
					>
						<input
							aria-label="Open a repository path"
							placeholder="Open a repository path"
							value={manualRoot}
							onChange={(event) => setManualRoot(event.target.value)}
						/>
					</form>
				</div>
				<div className="wp-gitx-head" title={overview?.upstream ? `Tracking ${overview.upstream}` : "No upstream"}>
					<Icon name="branch" />
					<strong>{branch ?? (overview?.head ? `Detached at ${overview.head.slice(0, 7)}` : "No commits yet")}</strong>
					{overview?.upstream && (
						<span className="wp-gitx-track">
							{overview.ahead > 0 && <span title={`${overview.ahead} to push`}>{`\u2191${overview.ahead}`}</span>}
							{overview.behind > 0 && <span title={`${overview.behind} to pull`}>{`\u2193${overview.behind}`}</span>}
							{overview.ahead === 0 && overview.behind === 0 && <span title="Up to date">{"\u2713"}</span>}
						</span>
					)}
				</div>
				<div className="wp-gitx-actions" role="toolbar" aria-label="Git actions">
					<button type="button" disabled={!overview || !!busy} onClick={() => void run("Fetched", { kind: "fetch" })}>
						<Icon name="fetch" />
						<span>Fetch</span>
					</button>
					<button
						type="button"
						disabled={!overview?.upstream || !!busy}
						onClick={() => void run("Pulled", { kind: "pull" })}
					>
						<Icon name="pull" />
						<span>Pull</span>
						{(overview?.behind ?? 0) > 0 && <b>{overview?.behind}</b>}
					</button>
					<button
						type="button"
						disabled={!branch || !overview?.remotes.length || !!busy}
						onClick={() => void run("Pushed", { kind: "push", force: false })}
					>
						<Icon name="push" />
						<span>Push</span>
						{(overview?.ahead ?? 0) > 0 && <b>{overview?.ahead}</b>}
					</button>
					<span className="wp-gitx-divider" />
					<button
						type="button"
						disabled={!overview?.head || !!busy}
						onClick={() => newBranch("HEAD", branch ?? "HEAD")}
					>
						<Icon name="branch" />
						<span>Branch</span>
					</button>
					<button
						type="button"
						disabled={!changes.length || !!busy}
						onClick={() => void run("Stashed changes", { kind: "stashSave", message: "", untracked: true })}
					>
						<Icon name="stash" />
						<span>Stash</span>
					</button>
					<button
						type="button"
						disabled={!overview?.stashes.length || !!busy}
						onClick={() => void run("Popped stash", { kind: "stashPop", index: 0 })}
					>
						<Icon name="unstash" />
						<span>Pop</span>
					</button>
					<span className="wp-gitx-divider" />
					<button
						type="button"
						className="wp-gitx-refresh"
						aria-label="Refresh"
						title="Refresh"
						disabled={!root || loading}
						onClick={() => void refresh()}
					>
						<Icon name="refresh" />
					</button>
				</div>
			</header>
			{state !== "clean" && (
				<div className="wp-gitx-state" role="status">
					<strong>
						{{ merging: "Merge", rebasing: "Rebase", "cherry-picking": "Cherry-pick", reverting: "Revert" }[state]} in
						progress.
					</strong>
					<span>Resolve conflicts, stage the files, then continue.</span>
					<button type="button" onClick={() => void run("Continued", { kind: "continue" })}>
						Continue
					</button>
					<button type="button" className="is-danger" onClick={() => void run("Aborted", { kind: "abort" })}>
						Abort
					</button>
				</div>
			)}
			{error && (
				<div className="wp-gitx-error" role="alert">
					{error}
				</div>
			)}
			<div className="wp-gitx-body" ref={body} style={{ ...sidebar.style, ...panel.style }}>
				<aside className="wp-gitx-sidebar" ref={sidebar.ref} aria-label="Branches">
					<input
						className="wp-gitx-filter"
						aria-label="Filter branches"
						placeholder="Filter branches and tags"
						value={filter}
						onChange={(event) => setFilter(event.target.value)}
					/>
					<Section title="Local" count={locals.length} icon="branch">
						<ul className="wp-gitx-refs">
							{locals.map((ref) => (
								<li key={ref.name}>
									<button
										type="button"
										className={ref.current ? "is-current" : ""}
										title={ref.upstream ? `${ref.name} \u2192 ${ref.upstream}` : ref.name}
										onClick={() => jumpTo(ref.target)}
										onDoubleClick={() =>
											!ref.current && void run(`Checked out ${ref.name}`, { kind: "checkout", ref: ref.name })
										}
										onContextMenu={(event) => branchMenu(event, ref)}
										onKeyDown={(event) => branchMenu(event, ref)}
									>
										{ref.current ? <Icon name="check" /> : <span className="wp-gitx-dot" />}
										<span className="wp-gitx-ref-name">{ref.name}</span>
										{ref.gone && <small className="wp-gitx-gone">gone</small>}
										{!!ref.ahead && <small>{`\u2191${ref.ahead}`}</small>}
										{!!ref.behind && <small>{`\u2193${ref.behind}`}</small>}
									</button>
								</li>
							))}
						</ul>
					</Section>
					{remoteNames.map((remote) => (
						<Section
							key={remote}
							title={remote}
							count={remotes.filter((ref) => ref.name.startsWith(`${remote}/`)).length}
							icon="cloud"
						>
							<ul className="wp-gitx-refs">
								{remotes
									.filter((ref) => ref.name.startsWith(`${remote}/`))
									.map((ref) => (
										<li key={ref.name}>
											<button
												type="button"
												title={ref.name}
												onClick={() => jumpTo(ref.target)}
												onDoubleClick={() => void run(`Checked out ${ref.name}`, { kind: "checkout", ref: ref.name })}
												onContextMenu={(event) => branchMenu(event, ref)}
												onKeyDown={(event) => branchMenu(event, ref)}
											>
												<span className="wp-gitx-dot" />
												<span className="wp-gitx-ref-name">{ref.name.slice(remote.length + 1)}</span>
											</button>
										</li>
									))}
							</ul>
						</Section>
					))}
					<Section title="Tags" count={tags.length} icon="tag" open={false}>
						<ul className="wp-gitx-refs">
							{tags.map((ref) => (
								<li key={ref.name}>
									<button
										type="button"
										title={ref.name}
										onClick={() => jumpTo(ref.target)}
										onContextMenu={(event) => branchMenu(event, ref)}
										onKeyDown={(event) => branchMenu(event, ref)}
									>
										<Icon name="tag" />
										<span className="wp-gitx-ref-name">{ref.name}</span>
									</button>
								</li>
							))}
						</ul>
					</Section>
					<Section title="Stashes" count={overview?.stashes.length ?? 0} icon="stash">
						<ul className="wp-gitx-refs">
							{overview?.stashes.map((stash) => (
								<li key={stash.index}>
									<button
										type="button"
										title={stash.message}
										onClick={(event) =>
											openMenu(event, [
												{
													label: "Apply",
													onSelect: () => void run("Applied stash", { kind: "stashApply", index: stash.index }),
												},
												{
													label: "Pop",
													onSelect: () => void run("Popped stash", { kind: "stashPop", index: stash.index }),
												},
												{
													label: "Drop\u2026",
													onSelect: () =>
														confirm(
															"Drop this stash?",
															stash.message,
															"Drop",
															() => void run("Dropped stash", { kind: "stashDrop", index: stash.index }),
														),
												},
											])
										}
									>
										<span className="wp-gitx-dot" />
										<span className="wp-gitx-ref-name">{stash.message.replace(/^On [^:]+: /, "")}</span>
										<small>{relativeTime(stash.date)}</small>
									</button>
								</li>
							))}
						</ul>
					</Section>
					<Section title="Worktrees" count={worktrees.length} icon="worktree" open={worktrees.length > 1}>
						<ul className="wp-gitx-refs">
							{worktrees.map((tree) => (
								<li key={tree.path}>
									<button
										type="button"
										className={tree.path === root ? "is-current" : ""}
										title={tree.path}
										disabled={tree.bare || tree.prunable !== undefined}
										onClick={() => switchRoot(tree.path)}
									>
										{tree.path === root ? <Icon name="check" /> : <span className="wp-gitx-dot" />}
										<span className="wp-gitx-ref-name">{tree.branch ?? repositoryLabel(tree.path)}</span>
										<small>{repositoryLabel(tree.path)}</small>
									</button>
								</li>
							))}
						</ul>
					</Section>
				</aside>
				{sidebar.separator}
				<main className="wp-gitx-main">
					{diff ? (
						<GitDiff
							diff={diff}
							onClose={() => {
								setDiff(undefined);
								setSelectedFile(undefined);
							}}
						/>
					) : (
						<CommitGraph
							commits={commits}
							head={overview?.head}
							changeCount={changes.length}
							selection={selection}
							onSelect={setSelection}
							onMenu={commitMenu}
						>
							{!complete && commits.length > 0 && (
								<button type="button" className="wp-gitx-more" onClick={() => void loadMore()}>
									Load more history
								</button>
							)}
							{overview && commits.length === 0 && (
								<p className="wp-gitx-empty">No commits yet. Stage files and make the first commit.</p>
							)}
							{!root && <p className="wp-gitx-empty">Choose a repository or enter its absolute path.</p>}
						</CommitGraph>
					)}
				</main>
				{panel.separator}
				<aside
					className="wp-gitx-panel"
					ref={panel.ref}
					aria-label={selection.kind === "changes" ? "Working changes" : "Commit details"}
				>
					{selection.kind === "changes" ? (
						<>
							<header className="wp-gitx-panel-head">
								<h2>Working changes</h2>
								<span>{branch ? `on ${branch}` : "detached"}</span>
							</header>
							<div className="wp-gitx-panel-scroll">
								<ChangeList
									title="Unstaged"
									changes={unstaged}
									staged={false}
									selected={selectedFile}
									onOpen={(change) => void openChange(change, false)}
									onStage={(paths) => void run("Staged", { kind: "stage", paths })}
									onDiscard={discard}
									onAll={() => void run("Staged all", { kind: "stage", paths: unstaged.map((change) => change.path) })}
									allLabel="Stage all"
								/>
								<ChangeList
									title="Staged"
									changes={staged}
									staged={true}
									selected={selectedFile}
									onOpen={(change) => void openChange(change, true)}
									onStage={(paths) => void run("Unstaged", { kind: "unstage", paths })}
									onAll={() =>
										void run("Unstaged all", { kind: "unstage", paths: staged.map((change) => change.path) })
									}
									allLabel="Unstage all"
								/>
							</div>
							<CommitForm
								draft={draft}
								onDraft={setDraft}
								stagedCount={staged.length}
								branch={branch}
								busy={!!busy}
								onCommit={commitNow}
							/>
						</>
					) : detail ? (
						<CommitDetail
							detail={detail}
							selectedFile={selectedFile}
							onJump={jumpTo}
							onOpenFile={(file) => void openCommitFile(detail.sha, file.path, file.status)}
						/>
					) : (
						<p className="wp-gitx-empty">{"Reading the commit\u2026"}</p>
					)}
				</aside>
			</div>
			{busy && (
				<div className="wp-gitx-busy" role="status">
					<span className="wp-gitx-spinner" />
					{`${busy}\u2026`}
				</div>
			)}
			{toast && !busy && (
				<div className={`wp-gitx-toast is-${toast.kind}`} role={toast.kind === "failed" ? "alert" : "status"}>
					<strong>{toast.title}</strong>
					{toast.text && <pre>{toast.text}</pre>}
					<button type="button" className="wp-gitx-mini" aria-label="Dismiss" onClick={() => setToast(undefined)}>
						<Icon name="close" />
					</button>
				</div>
			)}
			{ask && (
				<WorkplaceDialog
					title={ask.title}
					confirm={ask.confirm}
					danger={ask.kind === "confirm" && ask.danger}
					disabled={ask.kind === "name" && !askValue.trim()}
					focusConfirm={ask.kind === "confirm"}
					onCancel={() => setAsk(undefined)}
					onConfirm={() => {
						setAsk(undefined);
						if (ask.kind === "confirm") ask.run();
						else ask.run(askValue.trim());
					}}
				>
					<p>
						Repository: <code>{ask.root}</code>
					</p>
					{ask.kind === "confirm" ? (
						<p>{ask.body}</p>
					) : (
						<label>
							{ask.label}
							{/* biome-ignore lint/a11y/noAutofocus: the dialog exists to take this name. */}
							<input autoFocus value={askValue} onChange={(event) => setAskValue(event.target.value)} />
						</label>
					)}
				</WorkplaceDialog>
			)}
		</section>
	);
}
