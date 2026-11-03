import { useCallback, useEffect, useRef, useState } from "react";
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
import { Select } from "./workplace-fields.js";
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
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const LIVE = ["capturing", "queued", "running", "cancelling"];

const POLL_MS = 2000;
const ROW_PX = 34;

const QUEUE_SHARE = 0.4;

function stateTone(state: ReviewSummary["state"]): string {
	if (state === "failed" || state === "interrupted") return "bad";
	if (state === "incomplete" || state === "cancelling") return "warn";
	if (LIVE.includes(state)) return "live";
	return "done";
}

export function WorkplaceReviews({ root, active, world }: { root: string; active: boolean; world: WorldSnapshot }) {
	const api = window.agentWorkplace.reviews;
	const [queueState, setQueue] = useState<{ root: string; value: ReviewQueue }>();
	const queue = queueState?.root === root ? queueState.value : undefined;
	const [selected, select] = useState<string>();
	const [offset, setOffset] = useState(0);
	const [limit, setLimit] = useState(1);
	const list = useRef<HTMLDivElement>(null);
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
	const current = queue?.page?.rows.find((review) => review.id === selected);

	const liveTick = part === "log" || part === "mail" ? tick : 0;

	const detailKey = JSON.stringify([selected, current?.revision, part, path, side, detailOffset, limit, version]);
	const detail = detailState?.key === detailKey ? detailState.value : undefined;
	const [capture, showCapture] = useState(false);
	const [question, setQuestion] = useState("");
	const [reason, setReason] = useState("");
	const [doneWhen, setDoneWhen] = useState("");
	const [pending, setPending] = useState<{ attempt: string; operation: ReviewManagement }>();
	const live = queue?.page?.rows.some((review) => LIVE.includes(review.state)) ?? false;
	useEffect(() => {
		const element = list.current;
		if (!element) return;
		const observer = new ResizeObserver(() =>
			setLimit(Math.max(1, Math.floor((element.clientHeight * QUEUE_SHARE) / ROW_PX) - 2)),
		);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	useEffect(() => {
		if (!active || !(live || part === "log" || part === "mail")) return;
		const timer = setInterval(() => setTick((n) => n + 1), POLL_MS);
		return () => clearInterval(timer);
	}, [active, live, part]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Repository changes reset only local selection and paging.
	useEffect(() => {
		setOffset(0);
		select(undefined);
		setDetail(undefined);
	}, [root]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Explicit refresh and live ticks invalidate this on-demand query.
	useEffect(() => {
		if (!active) return;
		let current = true;
		void api
			// The page follows the selected review through live reordering, as the TUI queue does.
			.queue({
				...(root ? { cwd: root } : {}),
				limit,
				offset,
				hideAddressed,
				...(selected ? { around: selected } : {}),
			})
			.then((value) => {
				if (!current) return;
				setQueue({ root, value });
				if (value.page && value.page.offset !== offset) setOffset(value.page.offset);
				select((id) => (value.page?.rows.some((row) => row.id === id) ? id : value.page?.rows[0]?.id));
			})
			.catch((error) => {
				if (current) setError(errorText(error));
			});
		return () => {
			current = false;
		};
	}, [api, active, root, offset, limit, hideAddressed, selected, version, tick]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: The key holds every input; a live tick reloads log and mail under the same key.
	useEffect(() => {
		if (!active || !selected) return;
		let current = true;
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
				if (current) setDetail({ key: detailKey, value });
			})
			.catch((error) => {
				if (current) setError(errorText(error));
			});
		return () => {
			current = false;
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
	const action = (action: "cancel" | "resume", review: ReviewSummary) => {
		if (
			pending ||
			!window.confirm(
				`${action === "resume" ? "Resume reviewers on the same retained target? This can incur model cost." : "Cancel this review and wait for reviewer cleanup?"}\n${review.id}`,
			)
		)
			return;
		void manage({ attempt: crypto.randomUUID(), operation: { action, review: review.id } });
	};
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
	const states = queue?.states ?? {};
	const done = (states.completed ?? 0) + (states.incomplete ?? 0) + (states["no-changes"] ?? 0);
	return (
		<section className="wp-reviews" aria-label="Code reviews" hidden={!active}>
			<header>
				<h2>Reviews</h2>
				<p className="wp-reviews-strip" title="Review queue status">
					<span className="tone-wait">{states.queued ?? 0} queued</span>
					<span className="tone-live">{(states.running ?? 0) + (states.capturing ?? 0)} running</span>
					<span className="tone-done">{done} done</span>
					<span className="tone-bad">{(states.failed ?? 0) + (states.interrupted ?? 0)} failed</span>
					<span>
						passes {queue?.passes?.running ?? 0}/{queue?.passes?.limit ?? 0}
					</span>
				</p>
				<label className="wp-reviews-toggle">
					<input
						type="checkbox"
						checked={hideAddressed}
						onChange={(event) => {
							setHideAddressed(event.target.checked);
							select(undefined);
							setOffset(0);
						}}
					/>
					Hide addressed
				</label>
				<button type="button" aria-pressed={analytics} onClick={() => showAnalytics(!analytics)}>
					Analytics
				</button>
				<button type="button" onClick={() => refresh((n) => n + 1)}>
					Refresh
				</button>
				<button type="button" onClick={() => showCapture(!capture)}>
					Capture review
				</button>
			</header>
			{error && (
				<div role="alert" className="wp-code-error">
					{error}
				</div>
			)}
			{pending && (
				<div className="wp-code-notice">
					Unconfirmed request retained.{" "}
					<button type="button" disabled={busy} onClick={() => void manage(pending)}>
						Retry exact request
					</button>
					<button
						type="button"
						disabled={busy}
						onClick={() => {
							if (
								window.confirm(
									"Forget only this local retry? This does not undo or cancel runtime work. Inspect the queue before making another request.",
								)
							)
								setPending(undefined);
						}}
					>
						Forget local retry
					</button>
				</div>
			)}
			{capture && (
				<ReviewCapture
					owners={[
						...world.characters.filter((person) => !person.facts?.temporary),
						...(world.dormant ?? []).filter((person) => !person.temporary),
					]}
					api={api}
					root={root}
					onQueued={() => {
						showCapture(false);
						refresh((n) => n + 1);
					}}
				/>
			)}
			{analytics && <ReviewAnalyticsView api={api} root={root} version={version} />}
			<div className="wp-reviews-panes" ref={list} hidden={analytics}>
				<div className="wp-review-table">
					<div className="wp-review-head" aria-hidden="true">
						<span>Change</span>
						<span>Status</span>
						<span>Result</span>
						<span>Elapsed</span>
						<span>Cost</span>
						<span>Queued</span>
					</div>
					<ul className="wp-review-rows" aria-label="Review queue">
						{queue?.page?.rows.map((review) => (
							<li key={review.id}>
								<button
									type="button"
									aria-current={selected === review.id}
									className={`wp-review-row ${selected === review.id ? "is-selected" : ""} ${review.addressed ? "is-addressed" : ""}`}
									onClick={() => {
										select(review.id);
										setDetailOffset(0);
									}}
								>
									<span className="wp-review-change">
										<b>
											{review.label.repository} / {refLabel(review)}
										</b>{" "}
										{changeLabel(review)}
									</span>
									<span>
										<i className={`wp-review-pill tone-${stateTone(review.state)}`}>
											{review.state}
											{review.phase ? ` · ${review.phase.pass}` : ""}
										</i>
									</span>
									<span className={review.findings.confirmed > review.findings.responded ? "tone-warn" : ""}>
										{resultLabel(review)}
									</span>
									<span>{elapsedLabel(review)}</span>
									<span>{dollarsLabel(review.cost.reportedDollars)}</span>
									<span>{whenLabel(review.createdAt)}</span>
								</button>
							</li>
						))}
						{queue?.total === 0 && (
							<li>{hideAddressed ? "Every review here is addressed." : "No captured reviews in this directory."}</li>
						)}
					</ul>
					{(offset > 0 || queue?.page?.nextOffset != null) && (
						<nav>
							<button
								type="button"
								disabled={!offset}
								onClick={() => {
									select(undefined);
									setOffset(Math.max(0, offset - limit));
								}}
							>
								Previous
							</button>
							<span>
								{offset + 1}-{offset + (queue?.page?.rows.length ?? 0)} of {queue?.total ?? "-"}
							</span>
							<button
								type="button"
								disabled={queue?.page?.nextOffset == null}
								onClick={() => {
									select(undefined);
									setOffset(queue!.page!.nextOffset!);
								}}
							>
								Next
							</button>
						</nav>
					)}
				</div>
				<main aria-label="Review evidence">
					{current ? (
						<>
							<header className="wp-review-detail-head">
								<strong>{current.id.slice(-8)}</strong>
								<i className={`wp-review-pill tone-${stateTone(current.state)}`}>{current.state}</i>
								<span>{resultLabel(current)}</span>
								<span className="wp-review-change">
									<b>
										{current.label.repository} / {refLabel(current)}
									</b>{" "}
									{changeLabel(current)}
								</span>
								<span className="wp-review-owner">{current.ownerName}</span>
								<span className="wp-review-actions">
									<button
										type="button"
										disabled={busy}
										onClick={() => {
											void api
												.signOff({ review: current.id })
												.then(() => setError(""))
												.catch((error) => setError(errorText(error)));
										}}
									>
										Open captured sign-off
									</button>
									{["failed", "incomplete", "interrupted"].includes(current.state) && (
										<button type="button" disabled={busy || !!pending} onClick={() => action("resume", current)}>
											Resume
										</button>
									)}
									{["running", "queued", "capturing", "interrupted", "failed", "incomplete"].includes(
										current.state,
									) && (
										<button type="button" disabled={busy || !!pending} onClick={() => action("cancel", current)}>
											Cancel
										</button>
									)}
								</span>
							</header>
							<div className="wp-review-tabs" role="tablist" aria-label="Review evidence view">
								{parts.map((entry) => (
									<button
										type="button"
										role="tab"
										key={entry}
										aria-selected={part === entry}
										onClick={() => {
											setPart(entry);
											setDetailOffset(0);
										}}
									>
										{entry[0]!.toUpperCase() + entry.slice(1)}
									</button>
								))}
							</div>
							<div className="wp-review-body">
								{part === "source" && (
									<form onSubmit={(event) => event.preventDefault()}>
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
									<nav>
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
								{["completed", "incomplete", "failed", "interrupted", "cancelled"].includes(current.state) && (
									<details>
										<summary>Authorize additional work</summary>
										<form
											onSubmit={(event) => {
												event.preventDefault();
												if (
													!current.digest ||
													pending ||
													!window.confirm(
														"Replan this retained target with this question? Required inspections run again and can incur model cost. Live edits are not captured.",
													)
												)
													return;
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
											<input
												required
												aria-label="Additional review question"
												placeholder="Concrete question"
												value={question}
												onChange={(event) => setQuestion(event.target.value)}
											/>
											<input
												required
												aria-label="Reason for additional work"
												placeholder="Why more work is justified"
												value={reason}
												onChange={(event) => setReason(event.target.value)}
											/>
											<input
												required
												aria-label="Evidence that settles the question"
												placeholder="Stopping condition"
												value={doneWhen}
												onChange={(event) => setDoneWhen(event.target.value)}
											/>
											<button type="submit" disabled={busy || !!pending}>
												Authorize reviewer work
											</button>
										</form>
									</details>
								)}
							</div>
							<footer className="wp-review-foot">
								<span>{current.id}</span>
								<span>assessment {current.revision}</span>
								<span>
									cost {dollarsLabel(current.cost.reportedDollars)} ({current.cost.reportedAttempts}/
									{current.cost.totalAttempts} reported)
								</span>
								<span>{tokensLabel(current.cost)}</span>
							</footer>
						</>
					) : (
						<p className="wp-review-empty">Select a review to inspect its evidence.</p>
					)}
				</main>
			</div>
		</section>
	);
}

function ReviewAnalyticsView({ api, root, version }: { api: ReviewsApi; root: string; version: number }) {
	const [data, setData] = useState<{ key: string; value: ReviewAnalytics }>();
	const [error, setError] = useState("");
	const key = JSON.stringify([root, version]);
	useEffect(() => {
		let current = true;
		void api
			.analytics(root ? { cwd: root } : {})
			.then((value) => {
				if (!current) return;
				setError("");
				setData({ key, value });
			})
			.catch((error) => {
				if (current) setError(errorText(error));
			});
		return () => {
			current = false;
		};
	}, [api, root, key]);
	if (error) return <p role="alert">{error}</p>;
	const value = data?.key === key ? data.value : undefined;
	if (!value) return <p className="wp-review-empty">Loading analytics...</p>;
	const per = perLabel;
	return (
		<section className="wp-review-analytics" aria-label="Review analytics">
			<div className="wp-review-stats">
				<div>
					<b>{value.reviews}</b> reviews
				</div>
				<div>
					<b>{dollarsLabel(value.dollars)}</b> total, {per(value.dollars, value.reviews)} each
					{value.unreported ? `; ${value.unreported} attempts without cost` : ""}
				</div>
				<div>
					<b>{value.confirmed}</b> confirmed, {per(value.dollars, value.confirmed)} each
				</div>
				<div>
					<b>{value.medianMinutes === null ? "--" : `${value.medianMinutes.toFixed(1)} min`}</b> median review
				</div>
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
							<td>{row.state}</td>
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

function ReviewCapture({
	api,
	root,
	owners,
	onQueued,
}: {
	api: ReviewsApi;
	root: string;
	owners: { id: string; name: string }[];
	onQueued(): void;
}) {
	const [kind, setKind] = useState<ReviewTarget["kind"]>("working-tree");
	const [base, setBase] = useState("HEAD");
	const [head, setHead] = useState("HEAD");
	const [owner, setOwner] = useState("");
	const [intent, setIntent] = useState("");
	const [preview, setPreview] = useState<Awaited<ReturnType<ReviewsApi["preview"]>>>();
	const [request, setRequest] = useState<ReviewRequest>();
	const [pending, setPending] = useState<Parameters<ReviewsApi["enqueue"]>[0]>();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const queue = async (input: Parameters<ReviewsApi["enqueue"]>[0]) => {
		setBusy(true);
		setPending(input);
		setError("");
		try {
			await api.enqueue(input);
			onQueued();
		} catch (error) {
			setError(`${errorText(error)} This request may have applied; retry keeps its original identity.`);
		} finally {
			setBusy(false);
		}
	};
	return (
		<section className="wp-review-capture">
			<h3>Capture exact code before starting reviewers</h3>
			<form
				onSubmit={(event) => {
					event.preventDefault();
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
					const request = { cwd: root, target, ...(intent.trim() ? { intent: { text: intent } } : {}) };
					setRequest(request);
					void api
						.preview(request)
						.then(setPreview)
						.catch((error) => setError(errorText(error)))
						.finally(() => setBusy(false));
				}}
			>
				<fieldset disabled={busy || !!pending}>
					<legend>{root || "Select a repository first"}</legend>
					<div className="wp-field">
						<span>Target</span>
						<Select
							label="Target"
							value={kind}
							options={(["working-tree", "staged", "commit", "range", "branch"] as const).map((value) => ({
								value,
								label: value,
							}))}
							onChange={(next) => {
								setKind(next);
								setPreview(undefined);
							}}
						/>
					</div>
					<label>
						Base{" "}
						<input
							value={base}
							onChange={(event) => {
								setBase(event.target.value);
								setPreview(undefined);
							}}
						/>
					</label>
					<label>
						Head / commit{" "}
						<input
							value={head}
							onChange={(event) => {
								setHead(event.target.value);
								setPreview(undefined);
							}}
						/>
					</label>
					<label>
						Lasting owner ID{" "}
						<input
							required
							placeholder={owners
								.slice(0, 3)
								.map((person) => person.id)
								.join(", ")}
							value={owner}
							onChange={(event) => {
								setOwner(event.target.value);
								setPreview(undefined);
							}}
						/>
					</label>
					<label>
						Approved intent (optional){" "}
						<textarea
							value={intent}
							onChange={(event) => {
								setIntent(event.target.value);
								setPreview(undefined);
							}}
						/>
					</label>
					<button type="submit" disabled={!root}>
						Preview without reviewers
					</button>
				</fieldset>
			</form>
			{error && <p role="alert">{error}</p>}
			{preview && (
				<>
					<pre>{preview.lines.join("\n")}</pre>
					<p>
						Independent model usage can incur cost. Admission captures again and refuses changed identity. Empty
						comparisons do not start reviewers.
					</p>
					<button
						type="button"
						disabled={busy || !!pending || !preview.changedPaths}
						onClick={() =>
							request && void queue({ attempt: crypto.randomUUID(), request, expectedDigest: preview.digest, owner })
						}
					>
						Queue this captured identity
					</button>
				</>
			)}
			{pending && (
				<button type="button" disabled={busy} onClick={() => void queue(pending)}>
					Retry original capture request
				</button>
			)}
		</section>
	);
}
