import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
	analyticsLines,
	changeLabel,
	dollarsLabel,
	elapsedLabel,
	perLabel,
	refLabel,
	resultLabel,
	tokensLabel,
	unreportedLabel,
	whenLabel,
} from "../../../components/code-review/src/presentation.js";
import type {
	ReviewAnalytics,
	ReviewQueue,
	ReviewSource,
	ReviewSummary,
} from "../../../components/code-review/src/results.js";
import type { ReviewRequest, ReviewTarget } from "../../../components/code-review/src/types.js";
import type { ReviewManagement, ReviewsApi } from "../src/reviews.js";
import type { WorldSnapshot } from "../src/world.js";
import { WorkplaceDialog } from "./workplace-dialog.js";
import { Select } from "./workplace-fields.js";
import { Icon } from "./workplace-icon.js";
import { usePaneResize } from "./workplace-resize.js";
import type { ReviewUpdates } from "./workplace-review-updates.js";
import { EvidenceView, SourceView } from "./workplace-review-views.js";
import "./workplace-reviews.css";

const parts = [
	"summary",
	"findings",
	"mail",
	"log",
	"target",
	"source",
	"plan",
	"coverage",
	"attempts",
	"decisions",
	"configuration",
	"freshness",
] as const;
type Part = (typeof parts)[number];
const PRIMARY_PARTS: Part[] = ["summary", "findings", "mail", "log"];
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const SETTLED = ["completed", "incomplete", "failed", "interrupted", "cancelled"];
const POLL_MS = 2000;
const CARD_PX = 104;

type Tone = "live" | "wait" | "done" | "warn" | "bad" | "muted";

function stateTone(state: string): Tone {
	if (state === "failed" || state === "interrupted") return "bad";
	if (state === "incomplete" || state === "cancelling") return "warn";
	if (state === "queued" || state === "capturing") return "wait";
	if (state === "running") return "live";
	if (state === "cancelled") return "muted";
	return "done";
}

const STATE_LABEL: Record<string, string> = {
	capturing: "Capturing",
	queued: "Queued",
	running: "Reviewing",
	cancelling: "Cancelling",
	cancelled: "Cancelled",
	interrupted: "Interrupted",
	failed: "Failed",
	incomplete: "Incomplete",
	completed: "Completed",
	"no-changes": "No changes",
};
const stateLabel = (state: string) => STATE_LABEL[state] ?? state;

function initials(name: string) {
	const words = name.split(/\s+/).filter(Boolean);
	return ((words[0]?.[0] ?? "?") + (words.length > 1 ? (words.at(-1)?.[0] ?? "") : "")).toUpperCase();
}

function hue(text: string) {
	let sum = 0;
	for (const char of text) sum = (sum * 31 + char.charCodeAt(0)) % 360;
	return sum;
}

function titleOf(review: ReviewSummary) {
	if (review.target.kind === "working-tree") return "Uncommitted changes";
	if (review.target.kind === "staged") return "Staged changes";
	return review.label.subject ?? changeLabel(review) ?? review.id;
}

function StateBadge({ review }: { review: Pick<ReviewSummary, "state"> }) {
	return (
		<span className={`wp-rv-state tone-${stateTone(review.state)}`}>
			<i aria-hidden="true" />
			{stateLabel(review.state)}
		</span>
	);
}

function Avatar({ name }: { name: string }) {
	return (
		<span className="wp-rv-avatar" style={{ "--wp-rv-hue": hue(name) } as React.CSSProperties} title={name}>
			{initials(name)}
		</span>
	);
}

function FindingsBadge({ review }: { review: ReviewSummary }) {
	const open = review.findings.confirmed - review.findings.responded;
	const tone = open > 0 ? "warn" : review.findings.confirmed ? "done" : "muted";
	return <span className={`wp-rv-findings tone-${tone}`}>{resultLabel(review)}</span>;
}

function ReviewCard({
	review,
	selected,
	previous,
	onSelect,
}: {
	review: ReviewSummary;
	selected: boolean;
	previous: string | null | undefined;
	onSelect(): void;
}) {
	const updated = previous !== undefined;
	return (
		<li>
			<button
				type="button"
				aria-current={selected}
				aria-label={`${titleOf(review)}, ${stateLabel(review.state)}${updated ? ", updated" : ""}`}
				className={`wp-rv-card ${selected ? "is-selected" : ""} ${updated ? "is-updated" : ""} ${review.addressed ? "is-addressed" : ""}`}
				onClick={onSelect}
			>
				<span className="wp-rv-card-top">
					<StateBadge review={review} />
					{updated && (
						<span className="wp-rv-was">{previous ? `was ${stateLabel(previous).toLowerCase()}` : "new"}</span>
					)}
					<time dateTime={new Date(review.createdAt).toISOString()}>{whenLabel(review.createdAt)}</time>
				</span>
				<strong className="wp-rv-card-title">{titleOf(review)}</strong>
				<span className="wp-rv-card-ref">
					<span className="wp-rv-repo">{review.label.repository}</span>
					<Icon name="branch" />
					<span>{refLabel(review)}</span>
					{review.label.files !== null && (
						<span className="wp-rv-dim">
							{review.label.files} {review.label.files === 1 ? "file" : "files"}
						</span>
					)}
				</span>
				<span className="wp-rv-card-foot">
					<FindingsBadge review={review} />
					{review.state === "running" && review.passes ? (
						<span className="wp-rv-mini-meter" title={`${review.passes.completed} of ${review.passes.required} passes`}>
							<span style={{ width: `${(review.passes.completed / Math.max(1, review.passes.required)) * 100}%` }} />
						</span>
					) : (
						<span className="wp-rv-dim">{elapsedLabel(review)}</span>
					)}
					<span className="wp-rv-dim">{dollarsLabel(review.cost.reportedDollars)}</span>
					<Avatar name={review.ownerName} />
				</span>
			</button>
		</li>
	);
}

const STEPS = ["Queued", "Planning", "Inspecting", "Merging", "Settled"] as const;

function stepOf(review: ReviewSummary): { at: number; tone: Tone } {
	const { state, phase, passes } = review;
	if (state === "capturing" || state === "queued") return { at: 0, tone: "wait" };
	if (state === "completed" || state === "no-changes") return { at: 4, tone: "done" };
	if (state === "incomplete") return { at: 4, tone: "warn" };
	const reached =
		phase?.kind === "planner"
			? 1
			: phase?.kind === "validation"
				? 3
				: phase
					? 2
					: passes && passes.completed > 0
						? 2
						: 1;
	if (state === "running") return { at: reached, tone: "live" };
	if (state === "cancelling") return { at: reached, tone: "warn" };
	return { at: reached, tone: state === "cancelled" ? "muted" : "bad" };
}

function ReviewProgress({ review }: { review: ReviewSummary }) {
	const { at, tone } = stepOf(review);
	const detail = (index: number) => {
		if (index === 2 && review.passes) return `${review.passes.completed}/${review.passes.required} passes`;
		if (index === 1 && at === 1 && review.phase) return review.phase.pass;
		if (index === 4 && at === 4) return stateLabel(review.state);
		if (index === at && tone === "bad") return stateLabel(review.state);
		if (index === at && tone === "muted") return stateLabel(review.state);
		return "";
	};
	return (
		<ol className="wp-rv-steps" aria-label="Review progress">
			{STEPS.map((step, index) => {
				const status = index < at ? "done" : index === at ? `current tone-${tone}` : "todo";
				return (
					<li key={step} className={`is-${status}`} aria-current={index === at ? "step" : undefined}>
						<span className="wp-rv-step-dot" aria-hidden="true">
							{index < at || (index === at && tone === "done") ? <Icon name="check" /> : index + 1}
						</span>
						<span className="wp-rv-step-text">
							<b>{step}</b>
							<small>{detail(index)}</small>
						</span>
					</li>
				);
			})}
		</ol>
	);
}

function QueueStrip({ queue }: { queue?: ReviewQueue }) {
	const states = queue?.states ?? {};
	const done = (states.completed ?? 0) + (states.incomplete ?? 0) + (states["no-changes"] ?? 0);
	const chips: [string, number, Tone][] = [
		["reviewing", (states.running ?? 0) + (states.capturing ?? 0) + (states.cancelling ?? 0), "live"],
		["queued", states.queued ?? 0, "wait"],
		["done", done, "done"],
		["failed", (states.failed ?? 0) + (states.interrupted ?? 0), "bad"],
	];
	return (
		<p className="wp-rv-strip" title="Review queue status">
			{chips.map(([label, count, tone]) => (
				<span key={label} className={`tone-${tone} ${count ? "" : "is-zero"}`}>
					<i aria-hidden="true" />
					<b>{count}</b> {label}
				</span>
			))}
			<span className="tone-muted">
				passes{" "}
				<b>
					{queue?.passes?.running ?? 0}/{queue?.passes?.limit ?? 0}
				</b>
			</span>
		</p>
	);
}

type Confirm = { action: "cancel" | "resume"; review: ReviewSummary };

export function WorkplaceReviews({
	active,
	world,
	owners,
	updates,
	request,
}: {
	active: boolean;
	world: WorldSnapshot;
	owners?: Set<string>;
	updates: ReviewUpdates;
	request?: { id: string; key: string };
}) {
	const api = window.agentWorkplace.reviews;
	const [roots, setRoots] = useState<string[]>([]);
	const [root, setRoot] = useState("");
	const people = owners ? [...owners].sort() : undefined;
	const scope = `${root}\n${people?.join(",") ?? ""}`;
	const [queueState, setQueue] = useState<{ scope: string; value: ReviewQueue }>();
	const queue = queueState?.scope === scope ? queueState.value : undefined;
	const [selected, select] = useState<string>();
	const [offset, setOffset] = useState(0);
	const [limit, setLimit] = useState(1);
	const list = useRef<HTMLUListElement>(null);
	const body = useRef<HTMLDivElement>(null);
	const [part, setPart] = useState<Part>("summary");
	const [detailState, setDetail] = useState<{ key: string; value: unknown }>();
	const [detailOffset, setDetailOffset] = useState(0);
	const [path, setPath] = useState("");
	const [side, setSide] = useState<"before" | "after">("after");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const [version, refresh] = useState(0);
	const [tick, setTick] = useState(0);
	const [hideAddressed, setHideAddressed] = useState(false);
	const [analytics, showAnalytics] = useState(false);
	const [comment, setComment] = useState("");
	const [capture, showCapture] = useState(false);
	const [confirm, setConfirm] = useState<Confirm>();
	const [extending, setExtending] = useState(false);
	const [question, setQuestion] = useState("");
	const [reason, setReason] = useState("");
	const [doneWhen, setDoneWhen] = useState("");
	const [pending, setPending] = useState<{ attempt: string; operation: ReviewManagement }>();
	const current = queue?.page?.rows.find((review) => review.id === selected);
	const liveTick = part === "log" || part === "mail" ? tick : 0;
	const detailKey = JSON.stringify([selected, current?.revision, part, path, side, detailOffset, limit, version]);
	const detail = detailState?.key === detailKey ? detailState.value : undefined;
	const listPane = usePaneResize({
		label: "Review list width",
		variable: "--wp-rv-list",
		axis: "x",
		direction: 1,
		min: 280,
		max: () => (body.current?.clientWidth ?? 0) - 480,
	});
	const { markSeen } = updates;

	useEffect(() => {
		if (!active) return;
		void window.agentWorkplace.workspace.repositories().then((result) => {
			if (result.ok) setRoots(result.roots);
		});
	}, [active]);
	useEffect(() => {
		if (!request) return;
		setRoot("");
		setHideAddressed(false);
		showAnalytics(false);
		select(request.id);
		setPart("summary");
		setDetailOffset(0);
	}, [request]);
	useEffect(() => {
		const element = list.current;
		if (!element) return;
		const observer = new ResizeObserver(() => setLimit(Math.max(1, Math.floor(element.clientHeight / CARD_PX))));
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	useEffect(() => {
		if (!active) return;
		const timer = setInterval(() => setTick((n) => n + 1), POLL_MS);
		return () => clearInterval(timer);
	}, [active]);
	useEffect(() => {
		if (active && current) markSeen(current.id);
	}, [active, current, markSeen]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Explicit refresh and live ticks invalidate this on-demand query.
	useEffect(() => {
		if (!active) return;
		let live = true;
		void api
			.queue({
				...(root ? { cwd: root } : {}),
				...(people ? { people } : {}),
				limit,
				offset,
				hideAddressed,
				...(selected ? { around: selected } : {}),
			})
			.then((value) => {
				if (!live) return;
				setQueue({ scope, value });
				if (value.page && value.page.offset !== offset) setOffset(value.page.offset);
				select((id) => (value.page?.rows.some((row) => row.id === id) ? id : value.page?.rows[0]?.id));
			})
			.catch((error) => {
				if (live) setError(errorText(error));
			});
		return () => {
			live = false;
		};
	}, [api, active, scope, offset, limit, hideAddressed, selected, version, tick]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: The key holds every input; a live tick reloads log and mail under the same key.
	useEffect(() => {
		if (!active || !selected) return;
		let live = true;
		const request = { review: selected, limit, offset: detailOffset };
		const load =
			part === "source"
				? api.source({ ...request, side, ...(path ? { path } : {}) })
				: part === "freshness"
					? api.freshness({ review: selected })
					: part === "mail"
						? api.read({ ...request, part: "thread" })
						: part === "log"
							? api.read({ review: selected, part: "log", limit: 40 })
							: api.read({ ...request, part });
		void load
			.then((value) => {
				if (live) setDetail({ key: detailKey, value });
			})
			.catch((error) => {
				if (live) setError(errorText(error));
			});
		return () => {
			live = false;
		};
	}, [api, active, detailKey, liveTick]);
	const manage = useCallback(
		async (request: NonNullable<typeof pending>) => {
			setBusy(true);
			setError("");
			setPending(request);
			try {
				await api.manage(request);
				setPending(undefined);
				refresh((n) => n + 1);
				return true;
			} catch (error) {
				setError(`${errorText(error)} The request may have applied; retry this exact request before creating another.`);
				return false;
			} finally {
				setBusy(false);
			}
		},
		[api],
	);
	const data = detail as
		| {
				page?: { nextOffset: number | null };
				target?: { omissions?: { page?: { nextOffset: number | null } } };
				chunks?: { page?: { nextOffset: number | null } };
		  }
		| undefined;
	const next =
		part === "log"
			? null
			: (part === "target" ? data?.target?.omissions?.page : part === "plan" ? data?.chunks?.page : data?.page)
					?.nextOffset;
	const repositories = [...new Set([...roots, root].filter(Boolean))];
	const pickRepository = (next: string) => {
		setRoot(next);
		setOffset(0);
		select(undefined);
		setDetail(undefined);
	};
	return (
		<section className="wp-reviews" aria-label="Code reviews" hidden={!active}>
			<header className="wp-rv-toolbar">
				<div className="wp-rv-heading">
					<h2>Code reviews</h2>
					<QueueStrip queue={queue} />
				</div>
				<div className="wp-rv-controls">
					<Select
						label="Repository"
						className="wp-rv-repo-select"
						value={root}
						options={[
							{ value: "", label: "All repositories" },
							...repositories.map((path) => ({ value: path, label: path.split("/").at(-1) || path, detail: path })),
						]}
						onChange={pickRepository}
					/>
					<label className="wp-rv-switch">
						<input
							type="checkbox"
							checked={hideAddressed}
							onChange={(event) => {
								setHideAddressed(event.target.checked);
								select(undefined);
								setOffset(0);
							}}
						/>
						<span aria-hidden="true" />
						Hide addressed
					</label>
					{updates.updated.size > 0 && (
						<button type="button" className="wp-rv-ghost" onClick={updates.markAllSeen}>
							<Icon name="check" />
							Mark {updates.updated.size} seen
						</button>
					)}
					<button
						type="button"
						className="wp-rv-ghost"
						aria-pressed={analytics}
						onClick={() => showAnalytics(!analytics)}
					>
						<Icon name="chart" />
						Analytics
					</button>
					<button
						type="button"
						className="wp-rv-icon-button"
						aria-label="Refresh"
						title="Refresh"
						onClick={() => refresh((n) => n + 1)}
					>
						<Icon name="refresh" />
					</button>
					<button type="button" className="wp-rv-primary" onClick={() => showCapture(true)}>
						<Icon name="plus" />
						New review
					</button>
				</div>
			</header>
			{error && (
				<div role="alert" className="wp-rv-banner is-error">
					<span>{error}</span>
					<button type="button" aria-label="Dismiss" onClick={() => setError("")}>
						<Icon name="close" />
					</button>
				</div>
			)}
			{pending && (
				<div className="wp-rv-banner">
					<span>An unconfirmed request is kept so it can be retried with the same identity.</span>
					<button type="button" disabled={busy} onClick={() => void manage(pending)}>
						Retry exact request
					</button>
					<button type="button" disabled={busy} onClick={() => setPending(undefined)}>
						Forget local retry
					</button>
				</div>
			)}
			{analytics && <ReviewAnalyticsView api={api} root={root} version={version} />}
			<div className="wp-rv-body" ref={body} style={listPane.style} hidden={analytics}>
				<aside className="wp-rv-list" ref={listPane.ref} aria-label="Reviews">
					<ul ref={list} aria-label="Review queue">
						{queue?.page?.rows.map((review) => (
							<ReviewCard
								key={review.id}
								review={review}
								selected={selected === review.id}
								previous={updates.updated.has(review.id) ? updates.updated.get(review.id) : undefined}
								onSelect={() => {
									select(review.id);
									setDetailOffset(0);
								}}
							/>
						))}
						{queue?.total === 0 && (
							<li className="wp-rv-empty-list">
								<Icon name="review" />
								<b>{hideAddressed ? "Everything here is addressed" : "No reviews yet"}</b>
								<span>
									{hideAddressed
										? "Turn off Hide addressed to see them."
										: "Capture a change to send it to independent reviewers."}
								</span>
							</li>
						)}
					</ul>
					{(offset > 0 || queue?.page?.nextOffset != null) && (
						<nav className="wp-rv-pager">
							<button
								type="button"
								aria-label="Previous reviews"
								disabled={!offset}
								onClick={() => {
									select(undefined);
									setOffset(Math.max(0, offset - limit));
								}}
							>
								<Icon name="back" />
							</button>
							<span>
								{offset + 1}–{offset + (queue?.page?.rows.length ?? 0)} of {queue?.total ?? "-"}
							</span>
							<button
								type="button"
								aria-label="Next reviews"
								disabled={queue?.page?.nextOffset == null}
								onClick={() => {
									select(undefined);
									setOffset(queue!.page!.nextOffset!);
								}}
							>
								<Icon name="chevron-right" />
							</button>
						</nav>
					)}
				</aside>
				{listPane.separator}
				<main className="wp-rv-detail" aria-label="Review evidence">
					{current ? (
						<>
							<ReviewHero
								review={current}
								busy={busy || !!pending}
								onSignOff={() =>
									void api
										.signOff({ review: current.id })
										.then(() => setError(""))
										.catch((error) => setError(errorText(error)))
								}
								onAction={(action) => setConfirm({ action, review: current })}
								onExtend={() => setExtending(true)}
							/>
							<ReviewProgress review={current} />
							<div className="wp-rv-tabs" role="tablist" aria-label="Review evidence view">
								{parts.map((entry) => (
									<button
										type="button"
										role="tab"
										key={entry}
										className={PRIMARY_PARTS.includes(entry) ? "" : "is-evidence"}
										aria-selected={part === entry}
										onClick={() => {
											setPart(entry);
											setDetailOffset(0);
										}}
									>
										{entry[0]!.toUpperCase() + entry.slice(1)}
										{entry === "findings" && current.findings.confirmed > 0 && (
											<b className={current.findings.confirmed > current.findings.responded ? "is-open" : ""}>
												{current.findings.confirmed}
											</b>
										)}
									</button>
								))}
							</div>
							<div className="wp-review-body">
								{part === "source" && (
									<form className="wp-rv-source-form" onSubmit={(event) => event.preventDefault()}>
										<Select
											label="Captured side"
											value={side}
											options={[
												{ value: "after" as const, label: "after" },
												{ value: "before" as const, label: "before" },
											]}
											onChange={(next) => {
												setSide(next);
												setDetailOffset(0);
											}}
										/>
										<input
											aria-label="Captured file path"
											placeholder="Blank lists captured files"
											value={path}
											onChange={(event) => {
												setPath(event.target.value);
												setDetailOffset(0);
											}}
										/>
										<button type="button" onClick={() => refresh((n) => n + 1)}>
											Read
										</button>
									</form>
								)}
								{part === "source" && detail ? (
									<SourceView
										source={detail as ReviewSource}
										onOpen={(path) => {
											setPath(path);
											setDetailOffset(0);
										}}
									/>
								) : (
									<EvidenceView part={part} data={detail} />
								)}
								{part === "mail" && (
									<form
										className="wp-review-comment"
										onSubmit={(event) => {
											event.preventDefault();
											if (!comment.trim() || pending) return;
											const draft = comment;
											void manage({
												attempt: crypto.randomUUID(),
												operation: { action: "comment", review: current.id, body: draft.trim() },
											}).then((sent) => {
												if (sent) setComment((now) => (now === draft ? "" : now));
											});
										}}
									>
										<textarea
											aria-label="Comment on this review"
											placeholder="Comment; the owner is mailed"
											value={comment}
											onChange={(event) => setComment(event.target.value)}
										/>
										<button type="submit" disabled={busy || !!pending || !comment.trim()}>
											Comment
										</button>
									</form>
								)}
								{next != null || detailOffset ? (
									<nav className="wp-rv-pager">
										<button
											type="button"
											disabled={!detailOffset}
											onClick={() => setDetailOffset(Math.max(0, detailOffset - limit))}
										>
											Previous evidence page
										</button>
										<button type="button" disabled={next == null} onClick={() => setDetailOffset(next!)}>
											Next evidence page
										</button>
									</nav>
								) : null}
							</div>
						</>
					) : (
						<div className="wp-rv-empty-detail">
							<Icon name="review" />
							<b>Select a review</b>
							<span>Its progress, findings, mail and captured evidence appear here.</span>
						</div>
					)}
				</main>
			</div>
			{capture && (
				<ReviewCapture
					owners={[
						...world.characters.filter((person) => !person.facts?.temporary),
						...(world.dormant ?? []).filter((person) => !person.temporary),
					]}
					api={api}
					repositories={repositories}
					root={root || repositories[0] || ""}
					onClose={() => showCapture(false)}
					onQueued={(id) => {
						showCapture(false);
						select(id);
						refresh((n) => n + 1);
					}}
				/>
			)}
			{confirm && (
				<WorkplaceDialog
					title={confirm.action === "resume" ? "Resume this review?" : "Cancel this review?"}
					confirm={confirm.action === "resume" ? "Resume reviewers" : "Cancel review"}
					danger={confirm.action === "cancel"}
					focusConfirm
					onCancel={() => setConfirm(undefined)}
					onConfirm={() => {
						setConfirm(undefined);
						void manage({
							attempt: crypto.randomUUID(),
							operation: { action: confirm.action, review: confirm.review.id },
						});
					}}
				>
					<p>
						{confirm.action === "resume"
							? "Reviewers start again on the same retained target. This can incur model cost."
							: "Reviewers stop and clean up; findings so far stay recorded."}
					</p>
				</WorkplaceDialog>
			)}
			{extending && current && (
				<WorkplaceDialog
					title="Ask for more review"
					confirm="Authorize reviewer work"
					wide
					disabled={!question.trim() || !reason.trim() || !doneWhen.trim() || !current.digest}
					onCancel={() => setExtending(false)}
					onConfirm={() => {
						if (!current.digest) return;
						setExtending(false);
						void manage({
							attempt: crypto.randomUUID(),
							operation: {
								action: "extend",
								review: current.id,
								digest: current.digest,
								revision: current.revision,
								question,
								reason,
								doneWhen,
							},
						});
					}}
				>
					<p>
						The same captured change is planned again with this question. Required inspections run again and can incur
						model cost; live edits are not captured.
					</p>
					<label>
						Question
						<input
							aria-label="Additional review question"
							placeholder="What should reviewers answer?"
							value={question}
							onChange={(event) => setQuestion(event.target.value)}
						/>
					</label>
					<label>
						Why it is worth more work
						<input
							aria-label="Reason for additional work"
							value={reason}
							onChange={(event) => setReason(event.target.value)}
						/>
					</label>
					<label>
						Evidence that settles it
						<input
							aria-label="Evidence that settles the question"
							value={doneWhen}
							onChange={(event) => setDoneWhen(event.target.value)}
						/>
					</label>
				</WorkplaceDialog>
			)}
		</section>
	);
}

function ReviewHero({
	review,
	busy,
	onSignOff,
	onAction,
	onExtend,
}: {
	review: ReviewSummary;
	busy: boolean;
	onSignOff(): void;
	onAction(action: "cancel" | "resume"): void;
	onExtend(): void;
}) {
	const canResume = ["failed", "incomplete", "interrupted"].includes(review.state);
	const canCancel = ["running", "queued", "capturing", "interrupted", "failed", "incomplete"].includes(review.state);
	const approved = review.approval?.matchesAssessment;
	return (
		<header className="wp-rv-hero">
			<div className="wp-rv-hero-main">
				<div className="wp-rv-hero-kicker">
					<StateBadge review={review} />
					<span className="wp-rv-repo">{review.label.repository}</span>
					<Icon name="branch" />
					<span>{refLabel(review)}</span>
					<span className="wp-rv-dim">{review.target.kind}</span>
					{approved && <span className="wp-rv-approved">Signed off</span>}
				</div>
				<h2>{titleOf(review)}</h2>
				<div className="wp-rv-hero-meta">
					<span className="wp-rv-owner">
						<Avatar name={review.ownerName} />
						{review.ownerName}
					</span>
					<span>{elapsedLabel(review)}</span>
					<span>{dollarsLabel(review.cost.reportedDollars)}</span>
					<span title={tokensLabel(review.cost)}>assessment {review.revision}</span>
					<button
						type="button"
						className="wp-rv-id"
						title="Copy review ID"
						onClick={() => void navigator.clipboard.writeText(review.id)}
					>
						{review.id.slice(-8)}
						<Icon name="copy" />
					</button>
				</div>
			</div>
			<div className="wp-rv-hero-actions">
				{SETTLED.includes(review.state) && (
					<button type="button" className="wp-rv-ghost" disabled={busy} onClick={onExtend}>
						<Icon name="plus" />
						Ask for more
					</button>
				)}
				{canResume && (
					<button type="button" className="wp-rv-ghost" disabled={busy} onClick={() => onAction("resume")}>
						<Icon name="play" />
						Resume
					</button>
				)}
				{canCancel && (
					<button type="button" className="wp-rv-ghost is-danger" disabled={busy} onClick={() => onAction("cancel")}>
						<Icon name="stop" />
						Cancel
					</button>
				)}
				<button type="button" className="wp-rv-primary" disabled={busy} onClick={onSignOff}>
					<Icon name="signoff" />
					Open captured sign-off
				</button>
			</div>
		</header>
	);
}

function Stat({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
	return (
		<div className="wp-rv-stat">
			<span>{label}</span>
			<b>{value}</b>
			{note && <small>{note}</small>}
		</div>
	);
}

function ReviewAnalyticsView({ api, root, version }: { api: ReviewsApi; root: string; version: number }) {
	const [data, setData] = useState<{ key: string; value: ReviewAnalytics }>();
	const [error, setError] = useState("");
	const key = JSON.stringify([root, version]);
	useEffect(() => {
		let live = true;
		void api
			.analytics(root ? { cwd: root } : {})
			.then((value) => {
				if (!live) return;
				setError("");
				setData({ key, value });
			})
			.catch((error) => {
				if (live) setError(errorText(error));
			});
		return () => {
			live = false;
		};
	}, [api, root, key]);
	if (error) return <p role="alert">{error}</p>;
	const value = data?.key === key ? data.value : undefined;
	if (!value) return <p className="wp-review-empty">Loading analytics...</p>;
	const per = perLabel;
	return (
		<section className="wp-review-analytics" aria-label="Review analytics">
			<div className="wp-rv-stats">
				<Stat label="Reviews" value={value.reviews} />
				<Stat
					label="Spent"
					value={dollarsLabel(value.dollars)}
					note={`${per(value.dollars, value.reviews)} each${value.unreported ? `; ${value.unreported} attempts without cost` : ""}`}
				/>
				<Stat label="Confirmed findings" value={value.confirmed} note={`${per(value.dollars, value.confirmed)} each`} />
				<Stat
					label="Median review"
					value={value.medianMinutes === null ? "--" : `${value.medianMinutes.toFixed(1)} min`}
				/>
			</div>
			<h3>By model</h3>
			<table>
				<thead>
					<tr>
						<th>Model</th>
						<th>Attempts</th>
						<th>Cost</th>
						<th>Per attempt</th>
						<th>Confirmed</th>
						<th>Per finding</th>
						<th>Severity</th>
					</tr>
				</thead>
				<tbody>
					{value.byModel.map((row) => (
						<tr key={row.model}>
							<td>{row.model}</td>
							<td>
								{row.attempts}
								{unreportedLabel(row.attempts, row.reported)}
							</td>
							<td>{dollarsLabel(row.dollars)}</td>
							<td>{per(row.dollars, row.reported)}</td>
							<td>{row.confirmed}</td>
							<td>{per(row.dollars, row.confirmed)}</td>
							<td>
								{Object.entries(row.severities)
									.map(([severity, n]) => `${n} ${severity}`)
									.join(" · ")}
							</td>
						</tr>
					))}
				</tbody>
			</table>
			<h3>By phase</h3>
			<table>
				<thead>
					<tr>
						<th>Phase</th>
						<th>Attempts</th>
						<th>Cost</th>
						<th>Per attempt</th>
						<th>Minutes each</th>
					</tr>
				</thead>
				<tbody>
					{value.byPhase.map((row) => (
						<tr key={row.kind}>
							<td>{row.kind}</td>
							<td>
								{row.attempts}
								{unreportedLabel(row.attempts, row.reported)}
							</td>
							<td>{dollarsLabel(row.dollars)}</td>
							<td>{per(row.dollars, row.reported)}</td>
							<td>{row.attempts ? (row.minutes / row.attempts).toFixed(1) : "--"}</td>
						</tr>
					))}
				</tbody>
			</table>
			<h3>Reviews</h3>
			<table>
				<thead>
					<tr>
						<th>When</th>
						<th>Repository</th>
						<th>State</th>
						<th>Minutes</th>
						<th>Cost</th>
						<th>Confirmed</th>
					</tr>
				</thead>
				<tbody>
					{value.recent.map((row) => (
						<tr key={row.id}>
							<td>{whenLabel(row.createdAt)}</td>
							<td>{row.label.repository}</td>
							<td>
								<StateBadge review={row} />
							</td>
							<td>{row.minutes === null ? "--" : row.minutes.toFixed(0)}</td>
							<td>{dollarsLabel(row.dollars)}</td>
							<td>{row.confirmed}</td>
						</tr>
					))}
				</tbody>
			</table>
			<p className="wp-review-meta">{analyticsLines(value).at(-1)}</p>
		</section>
	);
}

const TARGETS: { value: ReviewTarget["kind"]; label: string; detail: string }[] = [
	{ value: "working-tree", label: "Working tree", detail: "Uncommitted changes against a base" },
	{ value: "staged", label: "Staged", detail: "The index against HEAD" },
	{ value: "commit", label: "Commit", detail: "One commit against its parent" },
	{ value: "range", label: "Range", detail: "Exact base and head" },
	{ value: "branch", label: "Branch", detail: "Head since its merge base, like a pull request" },
];

function ReviewCapture({
	api,
	root: initialRoot,
	repositories,
	owners,
	onClose,
	onQueued,
}: {
	api: ReviewsApi;
	root: string;
	repositories: string[];
	owners: { id: string; name: string }[];
	onClose(): void;
	onQueued(id: string): void;
}) {
	const [root, setRoot] = useState(initialRoot);
	const [kind, setKind] = useState<ReviewTarget["kind"]>("working-tree");
	const [base, setBase] = useState("HEAD");
	const [head, setHead] = useState("HEAD");
	const [owner, setOwner] = useState(owners[0]?.id ?? "");
	const [intent, setIntent] = useState("");
	const [preview, setPreview] = useState<Awaited<ReturnType<ReviewsApi["preview"]>>>();
	const [request, setRequest] = useState<ReviewRequest>();
	const [pending, setPending] = useState<Parameters<ReviewsApi["enqueue"]>[0]>();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const stale = () => setPreview(undefined);
	const queue = async (input: Parameters<ReviewsApi["enqueue"]>[0]) => {
		setBusy(true);
		setPending(input);
		setError("");
		try {
			const summary = await api.enqueue(input);
			onQueued(summary.id);
		} catch (error) {
			setError(`${errorText(error)} This request may have applied; retry keeps its original identity.`);
		} finally {
			setBusy(false);
		}
	};
	const runPreview = () => {
		setError("");
		setBusy(true);
		setPreview(undefined);
		const target: ReviewTarget =
			kind === "working-tree"
				? { kind, base }
				: kind === "staged"
					? { kind }
					: kind === "commit"
						? { kind, commit: head }
						: { kind, base, head };
		const next = { cwd: root, target, ...(intent.trim() ? { intent: { text: intent } } : {}) };
		setRequest(next);
		void api
			.preview(next)
			.then(setPreview)
			.catch((error) => setError(errorText(error)))
			.finally(() => setBusy(false));
	};
	const queued = () => {
		if (pending) return void queue(pending);
		if (preview && request)
			void queue({ attempt: crypto.randomUUID(), request, expectedDigest: preview.digest, owner });
	};
	return (
		<WorkplaceDialog
			title="New code review"
			wide
			confirm={
				pending
					? "Retry original capture request"
					: preview
						? "Queue this captured identity"
						: "Preview without reviewers"
			}
			disabled={busy || !root || !owner || (!!preview && !preview.changedPaths && !pending)}
			onCancel={onClose}
			onConfirm={() => (preview || pending ? queued() : runPreview())}
		>
			<p>Capture the exact change first. Reviewers start only after you queue the previewed identity.</p>
			<fieldset className="wp-rv-capture" disabled={busy || !!pending}>
				<div className="wp-dialog-field">
					<span>Repository</span>
					<Select
						label="Repository"
						value={root}
						options={repositories.map((path) => ({ value: path, label: path.split("/").at(-1) || path, detail: path }))}
						onChange={(next) => {
							setRoot(next);
							stale();
						}}
					/>
				</div>
				<fieldset className="wp-rv-segments" aria-label="Target">
					{TARGETS.map((target) => (
						<label key={target.value} title={target.detail}>
							<input
								type="radio"
								name="review-target"
								checked={kind === target.value}
								onChange={() => {
									setKind(target.value);
									stale();
								}}
							/>
							{target.label}
						</label>
					))}
				</fieldset>
				<div className="wp-rv-capture-row">
					{(kind === "working-tree" || kind === "range" || kind === "branch") && (
						<label>
							Base
							<input
								aria-label="Base"
								value={base}
								onChange={(event) => {
									setBase(event.target.value);
									stale();
								}}
							/>
						</label>
					)}
					{(kind === "commit" || kind === "range" || kind === "branch") && (
						<label>
							{kind === "commit" ? "Commit" : "Head"}
							<input
								aria-label="Head / commit"
								value={head}
								onChange={(event) => {
									setHead(event.target.value);
									stale();
								}}
							/>
						</label>
					)}
				</div>
				<div className="wp-dialog-field">
					<span>Owner</span>
					<Select
						label="Owner"
						value={owner}
						options={owners.map((person) => ({ value: person.id, label: person.name, detail: person.id }))}
						onChange={(next) => {
							setOwner(next);
							stale();
						}}
					/>
				</div>
				<label>
					Approved intent (optional)
					<textarea
						aria-label="Approved intent"
						rows={3}
						value={intent}
						onChange={(event) => {
							setIntent(event.target.value);
							stale();
						}}
					/>
				</label>
			</fieldset>
			{error && <p role="alert">{error}</p>}
			{preview && (
				<div className="wp-rv-preview">
					<pre>{preview.lines.join("\n")}</pre>
					<p>
						{preview.changedPaths
							? "Reviewers cost model usage. Admission captures again and refuses a changed identity."
							: "There is nothing to review in this comparison."}
					</p>
				</div>
			)}
		</WorkplaceDialog>
	);
}
