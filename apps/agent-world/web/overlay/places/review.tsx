// The review page (ticket 22): a pull request's diff by file, each line with its old and new line numbers and its
// hunk's context, and the operator's review as himself: a comment, an approval, or a change request. Each goes through
// the outside-write gate: the confirmation shows exactly what goes where, and only "Send as you" sends it through `gh`.
// Declining sends nothing. A sent review shows here, in the chatbox, and in the gate's local record.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { DiffFile, PullRequest } from "../../../src/integrations.js";
import { forge, prKey } from "./forge-state.js";
import { ConfirmWrite, confirming, useOutsideWrite } from "./outside-write.js";

/** A file longer than this many diff lines starts folded, so a large diff opens quickly. */
const FOLD_LINES = 400;

type Event = "comment" | "approve" | "request-changes";
const EVENT_WORDS: Record<Event, string> = {
	comment: "Comment",
	approve: "Approve",
	"request-changes": "Request changes",
};

const STATUS_WORDS: Record<DiffFile["status"], string> = {
	added: "Added",
	deleted: "Deleted",
	modified: "Changed",
	renamed: "Renamed",
};

const lineCount = (file: DiffFile) => file.hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0);
const fileId = (index: number) => `aw-diff-file-${index}`;

export function ReviewPage({ pr }: { pr: PullRequest }) {
	const state = useSyncExternalStore(forge.subscribe, forge.get);
	const key = prKey(pr);
	const loaded = state.details[key];
	const detail = loaded?.detail;
	const files = detail?.files ?? [];
	const { api } = state;
	const writeApi = useMemo(
		() =>
			api?.describeWrite && api.confirmWrite
				? { describeWrite: api.describeWrite, confirmWrite: api.confirmWrite }
				: undefined,
		[api],
	);
	const write = useOutsideWrite(writeApi);
	const draft = state.drafts[key] ?? "";
	const [current, setCurrent] = useState(0);
	const diff = useRef<HTMLElement>(null);
	const totals = useMemo(
		() =>
			files.reduce((sum, file) => ({ add: sum.add + file.additions, del: sum.del + file.deletions }), {
				add: 0,
				del: 0,
			}),
		[files],
	);

	// The file list follows the diff as it scrolls: the file whose header has passed the top is current.
	useEffect(() => {
		const scroller = diff.current;
		if (!scroller) return;
		const follow = () => {
			const top = scroller.getBoundingClientRect().top + 8;
			let at = 0;
			scroller.querySelectorAll<HTMLElement>(".aw-diff-file").forEach((element, index) => {
				if (element.getBoundingClientRect().top <= top) at = index;
			});
			setCurrent(at);
		};
		scroller.addEventListener("scroll", follow, { passive: true });
		return () => scroller.removeEventListener("scroll", follow);
	}, []);

	const sendable = (event: Event) => event === "approve" || draft.trim().length > 0;
	const review = (event: Event) => {
		if (!sendable(event)) return;
		void write.ask({ kind: "github-review", repo: pr.repo, number: pr.number, event, body: draft.trim() });
	};
	const asking = confirming(write.state);
	// While the confirmation shows, Escape or a click on the world declines it instead of closing the forge.
	const cancel = write.cancel;
	useEffect(() => {
		if (!asking) return;
		forge.guard(cancel);
		return () => forge.guard(undefined);
	}, [asking, cancel]);
	const sentHere = write.state.phase === "sent";
	// Once sent, the draft is spent and the page and the list are read again.
	useEffect(() => {
		if (sentHere) forge.reviewed(pr);
	}, [sentHere, pr]);

	return (
		<>
			<div className="aw-review" inert={asking || undefined}>
				<nav className="aw-forge-crumbs">
					<button
						type="button"
						className="aw-forge-back"
						title={`Back to #${pr.number}'s card`}
						onClick={() => forge.back()}
					>
						#{pr.number}
					</button>
				</nav>
				<header className="aw-review-head">
					<div className="aw-review-heading">
						<h2>{pr.title}</h2>
						<p className="aw-forge-card-meta">
							<span className="aw-forge-repo">{pr.repo}</span> <span className="aw-forge-number">#{pr.number}</span>
							{pr.branch && (
								<>
									{" \u00b7 "}
									<code className="aw-forge-branch">{pr.branch}</code>
									{detail?.baseBranch && (
										<>
											{" \u2192 "}
											<code className="aw-forge-branch">{detail.baseBranch}</code>
										</>
									)}
								</>
							)}
						</p>
					</div>
					{detail && (
						<p className="aw-review-totals">
							<span>
								{files.length} {files.length === 1 ? "file" : "files"}
							</span>
							<span className="aw-diff-add">+{totals.add}</span>
							<span className="aw-diff-del">&minus;{totals.del}</span>
						</p>
					)}
				</header>
				<div className="aw-review-body">
					<nav className="aw-review-files" aria-label="Files">
						<ul>
							{files.map((file, index) => (
								<li key={file.path}>
									<button
										type="button"
										className={`aw-review-file aw-review-file-${file.status}${index === current ? " aw-on" : ""}`}
										title={file.path}
										aria-current={index === current ? "true" : undefined}
										onClick={() => {
											setCurrent(index);
											document.getElementById(fileId(index))?.scrollIntoView({ block: "start" });
										}}
									>
										<span className="aw-review-file-name">
											<span className="aw-review-file-dir">{file.path.split("/").slice(0, -1).join("/")}</span>
											{file.path.split("/").pop()}
										</span>
										<span className="aw-review-file-counts">
											{file.additions > 0 && <span className="aw-diff-add">+{file.additions}</span>}
											{file.deletions > 0 && <span className="aw-diff-del">&minus;{file.deletions}</span>}
										</span>
									</button>
								</li>
							))}
						</ul>
					</nav>
					<section ref={diff} className="aw-review-diff" aria-label="Diff" tabIndex={-1}>
						{!detail && loaded?.state !== "failed" && <p className="aw-place-empty">Reading the diff&hellip;</p>}
						{loaded?.state === "failed" && !detail && (
							<p className="aw-progress aw-progress-failed" role="status">
								{loaded.reason}
							</p>
						)}
						{detail && files.length === 0 && <p className="aw-place-empty">No changes in this pull request.</p>}
						{files.map((file, index) => (
							<FileDiff key={file.path} file={file} index={index} />
						))}
						{detail?.cut && (
							<p className="aw-review-cut">
								The diff goes on beyond what this page shows.{" "}
								<button type="button" className="aw-forge-link" onClick={() => void forge.openInGitHub(pr)}>
									See the rest on GitHub
								</button>
							</p>
						)}
					</section>
				</div>
				<form
					className="aw-review-compose"
					onSubmit={(event) => {
						event.preventDefault();
						review("comment");
					}}
				>
					<textarea
						className="aw-review-text"
						aria-label="Your review"
						placeholder="Write your review as you. Approve needs no words; a comment or a change request does."
						rows={3}
						value={draft}
						onChange={(event) => forge.setDraft(pr, event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
								event.preventDefault();
								review("comment");
							}
						}}
					/>
					<div className="aw-review-send">
						<ReviewStatus state={write.state} onDismiss={write.cancel} />
						<div className="aw-review-buttons">
							{(["comment", "request-changes", "approve"] as const).map((event) => (
								<button
									key={event}
									type={event === "comment" ? "submit" : "button"}
									className={`aw-button aw-review-${event}${event === "approve" ? " aw-button-strong" : ""}`}
									disabled={!sendable(event) || write.state.phase === "describing"}
									title={sendable(event) ? undefined : "Write what to say first"}
									onClick={event === "comment" ? undefined : () => review(event)}
								>
									{EVENT_WORDS[event]}
								</button>
							))}
						</div>
					</div>
				</form>
			</div>
			{(write.state.phase === "confirming" || write.state.phase === "sending") && (
				<ConfirmWrite state={write.state} onConfirm={() => void write.confirm()} onCancel={write.cancel} />
			)}
		</>
	);
}

/** What became of the last review asked for: being described, sent (with where to see it), or why it was not. */
function ReviewStatus({
	state,
	onDismiss,
}: {
	state: ReturnType<typeof useOutsideWrite>["state"];
	onDismiss: () => void;
}) {
	if (state.phase === "describing")
		return (
			<p className="aw-progress aw-progress-sending" role="status">
				Getting it ready to confirm&hellip;
			</p>
		);
	if (state.phase === "sent")
		return (
			<p className="aw-progress aw-progress-done" role="status">
				{state.entry.line}{" "}
				{state.entry.url && (
					<button
						type="button"
						className="aw-forge-link"
						onClick={() => void forge.get().api?.openLink?.(state.entry.url!)}
					>
						See it on GitHub
					</button>
				)}
			</p>
		);
	if (state.phase === "failed")
		return (
			<p className="aw-progress aw-progress-failed" role="status">
				{state.reason}{" "}
				<button type="button" className="aw-forge-link" onClick={onDismiss}>
					Dismiss
				</button>
			</p>
		);
	return <p className="aw-review-hint">Nothing is sent until you confirm it.</p>;
}

/** One file's diff: its header, then each hunk with its context line and every line numbered on both sides. */
function FileDiff({ file, index }: { file: DiffFile; index: number }) {
	const lines = lineCount(file);
	const [open, setOpen] = useState(lines <= FOLD_LINES);
	const name =
		file.status === "renamed" && file.oldPath !== file.path ? `${file.oldPath} \u2192 ${file.path}` : file.path;
	return (
		<section id={fileId(index)} className={`aw-diff-file aw-diff-file-${file.status}`} aria-label={file.path}>
			<header className="aw-diff-file-head">
				<span className={`aw-diff-status aw-diff-status-${file.status}`}>{STATUS_WORDS[file.status]}</span>
				<span className="aw-diff-path">{name}</span>
				<span className="aw-review-file-counts">
					{file.additions > 0 && <span className="aw-diff-add">+{file.additions}</span>}
					{file.deletions > 0 && <span className="aw-diff-del">&minus;{file.deletions}</span>}
				</span>
			</header>
			{file.binary ? (
				<p className="aw-diff-note">A binary file: its change is not shown here.</p>
			) : !open ? (
				<p className="aw-diff-note">
					{lines.toLocaleString()} changed lines.{" "}
					<button type="button" className="aw-forge-link" onClick={() => setOpen(true)}>
						Show them
					</button>
				</p>
			) : file.hunks.length === 0 ? (
				<p className="aw-diff-note">No line changes (a mode change or an empty file).</p>
			) : (
				<table className="aw-diff">
					<tbody>
						{file.hunks.map((hunk, h) => [
							// biome-ignore lint/suspicious/noArrayIndexKey: a diff's hunks and lines have no identity but their place, and never reorder
							<tr key={`h${h}`} className="aw-diff-hunk">
								<td colSpan={3}>{hunk.header}</td>
							</tr>,
							...hunk.lines.map((line, l) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: as above
								<tr key={`${h}:${l}`} className={`aw-diff-line aw-diff-${line.kind}`}>
									<td className="aw-diff-no" data-no={line.old ?? ""} />
									<td className="aw-diff-no" data-no={line.new ?? ""} />
									<td className="aw-diff-code">
										<span className="aw-diff-sign" aria-hidden="true">
											{line.kind === "add" ? "+" : line.kind === "del" ? "\u2212" : " "}
										</span>
										{line.text}
									</td>
								</tr>
							)),
						])}
					</tbody>
				</table>
			)}
		</section>
	);
}
