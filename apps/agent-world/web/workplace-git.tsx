import { useEffect, useState } from "react";
import type { WorkspaceApi, WorkspaceGitEntry } from "../src/workspace.js";
import "./workplace-git.css";

type Selection = { path: string; staged: boolean };
export type GitDiffView = Selection & { text: string };
type Status = Awaited<ReturnType<WorkspaceApi["gitStatus"]>>;
type GitPaneProps = {
	root: string;
	onOpenFile: (path: string) => void;
	onDiff: (diff: GitDiffView) => void;
};

export function GitPane(props: GitPaneProps) {
	return <RepositoryGit key={props.root} {...props} />;
}

function RepositoryGit({ root, onOpenFile, onDiff }: GitPaneProps) {
	const [status, setStatus] = useState<Status>();
	const [loading, setLoading] = useState(false);
	const [request, setRequest] = useState({ root });
	const [selected, setSelected] = useState<Selection>();
	const [readingDiff, setReadingDiff] = useState(false);
	const [diffError, setDiffError] = useState<string>();
	useEffect(() => {
		let current = true;
		setLoading(true);
		void window.agentWorld.workspace
			.gitStatus(request)
			.then((result) => {
				if (current) setStatus(result);
			})
			.catch((reason) => {
				if (current) setStatus({ ok: false, reason: String(reason) });
			})
			.finally(() => {
				if (current) setLoading(false);
			});
		return () => {
			current = false;
		};
	}, [request]);
	useEffect(() => {
		let current = true;
		setDiffError(undefined);
		setReadingDiff(!!selected);
		if (selected) {
			void window.agentWorld.workspace
				.gitDiff({ root, ...selected })
				.then((result) => {
					if (!current) return;
					if (result.ok) onDiff({ ...selected, text: result.text });
					else setDiffError(result.reason);
				})
				.catch((reason) => {
					if (current) setDiffError(String(reason));
				})
				.finally(() => {
					if (current) setReadingDiff(false);
				});
		}
		return () => {
			current = false;
		};
	}, [root, selected, onDiff]);

	const entries = status?.ok ? status.entries : [];
	const groups = [
		{
			title: "Staged",
			staged: true,
			entries: entries.filter((entry) => entry.index !== " " && entry.index !== "?" && entry.index !== "!"),
		},
		{
			title: "Unstaged",
			staged: false,
			entries: entries.filter((entry) => entry.worktree !== " " && entry.worktree !== "?" && entry.worktree !== "!"),
		},
		{
			title: "Untracked",
			staged: false,
			entries: entries.filter((entry) => entry.index === "?" && entry.worktree === "?"),
		},
	];
	const badge = (entry: WorkspaceGitEntry, staged: boolean) => (staged ? entry.index : entry.worktree);
	return (
		<section className="wp-git" aria-label="Source control">
			<header className="wp-git-header">
				<div>
					<div className="wp-git-title">
						<h2>Source control</h2>
						<span>Read-only</span>
					</div>
					{status?.ok && <p className="wp-git-branch">{status.branch ?? "Detached HEAD"}</p>}
					<p title={root}>{root}</p>
				</div>
				<button type="button" onClick={() => setRequest({ root })} disabled={loading}>
					Refresh Git
				</button>
			</header>
			{loading && (
				<p className="wp-git-notice" role="status">
					Reading Git status...
				</p>
			)}
			{status && !status.ok && (
				<p className="wp-git-notice" role="alert">
					{status.reason}
				</p>
			)}
			{status?.ok && entries.length === 0 && <p className="wp-git-notice">Working tree clean.</p>}
			{readingDiff && (
				<p className="wp-git-notice" role="status">
					Reading diff: {selected?.path}
				</p>
			)}
			{diffError && (
				<p className="wp-git-notice" role="alert">
					{diffError}
				</p>
			)}
			<nav className="wp-git-files" aria-label="Changed files">
				{groups
					.filter((group) => group.entries.length > 0)
					.map((group) => (
						<section key={group.title} aria-label={group.title}>
							<h3>
								{group.title} <span>{group.entries.length}</span>
							</h3>
							<ul>
								{group.entries.map((entry) => (
									<li
										key={entry.path}
										data-selected={selected?.path === entry.path && selected.staged === group.staged}
									>
										<span className="wp-git-badge" title={group.title}>
											{badge(entry, group.staged)}
										</span>
										<div className="wp-git-file-name">
											<button
												type="button"
												className="wp-git-open"
												aria-label={`Open file: ${entry.path}`}
												title={entry.path}
												onClick={() => {
													setSelected(undefined);
													onOpenFile(entry.path);
												}}
											>
												{entry.path}
											</button>
											{entry.previousPath && <small>From {entry.previousPath}</small>}
										</div>
										<button
											type="button"
											className="wp-git-view"
											aria-label={`View ${group.title.toLowerCase()} diff: ${entry.path}`}
											aria-pressed={selected?.path === entry.path && selected.staged === group.staged}
											onClick={() => setSelected({ path: entry.path, staged: group.staged })}
										>
											View diff
										</button>
									</li>
								))}
							</ul>
						</section>
					))}
			</nav>
		</section>
	);
}

export function GitDiffText({ text }: { text: string }) {
	if (!text)
		return <p className="wp-git-diff-empty">No text diff. Open the file to inspect untracked or binary content.</p>;
	return (
		// biome-ignore lint/a11y/noNoninteractiveTabindex: the diff scrolls with the keyboard.
		<pre className="wp-git-diff-text" tabIndex={0}>
			<code>
				{text.split(/(?<=\n)/).map((line, index) => {
					const kind =
						line.startsWith("+") && !line.startsWith("+++")
							? "added"
							: line.startsWith("-") && !line.startsWith("---")
								? "removed"
								: "context";
					return (
						// biome-ignore lint/suspicious/noArrayIndexKey: diff lines are stateless text with positional identity.
						<span key={index} className={`wp-git-line-${kind}`}>
							{line}
						</span>
					);
				})}
			</code>
		</pre>
	);
}
